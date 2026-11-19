import { CARD_SIZE, resolveViewpoint, vector } from "./camera.js";
import { interpFraction } from "./animation.js";
const BUTTONS = new Set([
  "BACK_BUTTON",
  "UP_BUTTON",
  "DOWN_BUTTON",
  "LEFT_BUTTON",
  "RIGHT_BUTTON",
]);
/** CardViewerPanel.getButtonRegion: 5%边距、40原版卡片像素，返回比例坐标。 */
export function buttonRegion(direction) {
  const size = 40 / CARD_SIZE,
    near = 0.05,
    center = 0.5 - size / 2,
    far = 1 - size - near;
  const positions = {
    NORTH: [center, near],
    SOUTH: [center, far],
    EAST: [far, center],
    WEST: [near, center],
    NORTHEAST: [far, near],
    NORTHWEST: [near, near],
    SOUTHEAST: [far, far],
    SOUTHWEST: [near, far],
  };
  const position = positions[direction] || [0, 0];
  return [...position, size, size];
}
export function hotspotRegion(transition) {
  if (BUTTONS.has(transition.attrs.hotspotStyle))
    return buttonRegion(transition.attrs.buttonLocation);
  return vector(transition.attrs.hotspotRegion, 4);
}
function viewNode(project, location) {
  return project.container(location, "viewpoint")[0];
}
/** 原版Scene.getInterpLocations；当前构建的Comparer.Compare两次读arg1，故所有比较为0。
 * 实际项目每对最多3个中间位置；当前保留XML次序。原Mono List.Sort同值排序的稳定性尚未运行核实。
 */
export function transitionLocations(project, from, to) {
  if (!from || !to) return [];
  const scene = project.owner(from, "Scene");
  if (!scene) return [from, to];
  const candidates = project
    .container(scene, "sceneLocations")
    .filter((location) => {
      const vp = viewNode(project, location);
      return (
        vp?.type === "InterpViewpoint" &&
        ((vp.attrs.fromLocation === from.attrs.guid &&
          vp.attrs.toLocation === to.attrs.guid) ||
          (vp.attrs.fromLocation === to.attrs.guid &&
            vp.attrs.toLocation === from.attrs.guid))
      );
    });
  return [from, ...candidates, to];
}
function keyframes(project, transition) {
  return project
    .container(transition, "positionByKeyframe")
    .flatMap((map) => project.direct(map, "entry"))
    .map((entry) => ({
      time: Number(entry.attrs.key),
      value: vector(entry.attrs.value, 3),
    }))
    .sort((a, b) => a.time - b.time);
}
export function planTransition(project, transition) {
  if (transition?.type !== "LocationTransition")
    throw new Error("导航目标必须为LocationTransition");
  const origin = project.owner(transition, "SceneLocation"),
    destination = project.get(transition.attrs.destLocation);
  let fromLocation = project.get(transition.attrs.animStartLocation) || origin,
    toLocation = project.get(transition.attrs.animEndLocation) || destination;
  if (
    !origin ||
    destination?.type !== "SceneLocation" ||
    fromLocation?.type !== "SceneLocation" ||
    toLocation?.type !== "SceneLocation"
  )
    throw new Error("导航缺少有效起点/终点");
  const fromScene = project.owner(fromLocation, "Scene"),
    toScene = project.owner(toLocation, "Scene");
  if (fromScene !== toScene) {
    if (transition.attrs.hotspotStyle === "BACK_BUTTON")
      fromLocation =
        project
          .container(toScene, "sceneLocations")
          .find(
            (location) =>
              location.attrs.backgroundLocation === fromLocation.attrs.guid,
          ) || fromLocation;
    else
      toLocation =
        project
          .container(fromScene, "sceneLocations")
          .find(
            (location) =>
              location.attrs.backgroundLocation === toLocation.attrs.guid,
          ) || toLocation;
  }
  const startVP =
      project.get(transition.attrs.animStartViewpoint) || fromLocation,
    endVP = project.get(transition.attrs.animEndViewpoint) || toLocation;
  const frames = keyframes(project, transition);
  if (frames.some((frame) => !Number.isFinite(frame.time)))
    throw new Error("导航关键帧时间无效");
  const durationSeconds = frames.length
    ? Math.trunc(frames.at(-1).time * 1000) / 1000
    : Math.max(0, Number(transition.attrs.transitionDuration ?? 800)) / 1000;
  return {
    transition,
    origin,
    destination,
    fromLocation,
    toLocation,
    from: resolveViewpoint(project, startVP),
    to: resolveViewpoint(project, endVP),
    locations: transitionLocations(project, fromLocation, toLocation),
    durationSeconds,
    keyframes: frames,
    startFrame: Number(transition.attrs.animationStartFrame || 0),
    reverse: transition.attrs.animationReversed === "true",
    interpFunction: transition.attrs.interpFunction || "SINE",
  };
}
function sampleKeyframes(frames, time) {
  if (time <= frames[0].time) return [...frames[0].value];
  if (time >= frames.at(-1).time) return [...frames.at(-1).value];
  const hi = frames.findIndex((frame) => frame.time > time),
    a = frames[hi - 1],
    b = frames[hi],
    fraction = (time - a.time) / (b.time - a.time);
  return a.value.map((value, i) => value + (b.value[i] - value) * fraction);
}
/** elapsedSeconds自本次导航开始计时；相机只插值translation，保留from旋转/缩放。 */
export function sampleTransition(plan, elapsedSeconds) {
  const raw = plan.durationSeconds
    ? Math.max(0, Math.min(1, elapsedSeconds / plan.durationSeconds))
    : 1;
  const fraction = plan.keyframes.length
    ? plan.reverse
      ? 1 - raw
      : raw
    : interpFraction(plan.interpFunction, raw);
  let offset;
  if (plan.keyframes.length) {
    const last = plan.keyframes.at(-1).time,
      time = plan.startFrame + (last - plan.startFrame) * fraction,
      current = sampleKeyframes(plan.keyframes, time),
      base = sampleKeyframes(
        plan.keyframes,
        plan.reverse ? last : plan.startFrame,
      );
    offset = current.map((value, i) => value - base[i]);
  } else
    offset = plan.to.camera.position.map(
      (value, i) => (value - plan.from.camera.position[i]) * fraction,
    );
  return {
    viewpoint: {
      camera: plan.from.camera.offset(offset),
      viewport: plan.from.viewport.map(
        (value, i) => value + (plan.to.viewport[i] - value) * fraction,
      ),
    },
    fraction,
    complete: raw >= 1,
    locationGUIDs: plan.locations.map((location) => location.attrs.guid),
  };
}
