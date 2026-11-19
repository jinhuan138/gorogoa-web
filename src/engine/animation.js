import { CARD_SIZE, affine, identity2, multiply2, vector } from "./camera.js";
const f = Math.fround;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const rangeFraction = (value, min, max) =>
  max === min ? 0 : (value - min) / (max - min);
export function interpFraction(name = "NONE", value) {
  const sine = (x, a, b) =>
    rangeFraction(
      Math.sin((a + (b - a) * x) * 1.5707963705062866),
      Math.sin(a * 1.5707963705062866),
      Math.sin(b * 1.5707963705062866),
    );
  switch (name) {
    case "NONE":
      return value;
    case "REVERSE":
      return 1 - value;
    case "SINE":
      return sine(value, -1, 1);
    case "FROM_SINE":
      return sine(value, -1, 0);
    case "TO_SINE":
      return sine(value, 0, 1);
    case "REVERSE_SINE":
      return sine(1 - value, -1, 1);
    case "REVERSE_FROM_SINE":
      return 1 - sine(value, -1, 0);
    case "REVERSE_TO_SINE":
      return 1 - sine(value, 0, 1);
    default:
      throw new Error(`尚未实现插值函数 ${name}`);
  }
}
export function angleLerp(a, b, fraction) {
  const tau = Math.PI * 2;
  if (Math.abs(b - a) > Math.PI) {
    if (a < b) b -= tau;
    else a -= tau;
  }
  let value = a + (b - a) * fraction;
  if (value < 0) value += tau;
  else if (value >= tau) value -= tau;
  return value;
}
const roundEven = (x) => {
  const lower = Math.floor(x),
    fraction = x - lower;
  return fraction === 0.5
    ? lower % 2 === 0
      ? lower
      : lower + 1
    : Math.round(x);
};
export function graphicBounds(project, node, seen = new Set()) {
  if (node?.type === "LinkedGraphic" && !seen.has(node)) {
    const target = project.get(node.attrs.graphic);
    if (target?.type === "SceneLocation") return [0, 0, CARD_SIZE, CARD_SIZE];
    const layer = project.owner(target, "LocationLayer");
    if (project.get(layer?.attrs.sceneLayer)?.attrs.isBackground === "true") {
      seen.add(node);
      return graphicBounds(project, target, seen);
    }
  }
  const location = project.owner(node, "SceneLocation");
  const margin = vector(
    node?.attrs.marginsRegion ?? location?.attrs.marginsRegion,
    4,
    [0, 0, 1, 1],
  );
  return margin.map((v) => v * CARD_SIZE);
}

export class AnimationSampler {
  constructor(project, { sequenceFrames, scriptDurationMillis } = {}) {
    this.project = project;
    this.sequenceFrames = sequenceFrames;
    this.scriptDurationMillis = scriptDurationMillis;
    this.channels = new WeakMap();
    this.durationCache = new WeakMap();
  }
  keyframeSource(node) {
    if (node.attrs.inputMode === "SCRIPT")
      throw new Error("脚本关键帧尚未实现");
    if (node.attrs.inputMode === "LINK") {
      const linked = this.project.get(node.attrs.linkedKeyframes);
      if (!linked)
        throw new Error(`关键帧链接缺失 ${node.attrs.linkedKeyframes}`);
      return linked;
    }
    return node;
  }
  channel(node, name) {
    let all = this.channels.get(node);
    if (!all) {
      all = new Map();
      this.channels.set(node, all);
    }
    if (all.has(name)) return all.get(name);
    const source = this.keyframeSource(node);
    const map = this.project
      .container(source, name)
      .flatMap((item) => this.project.direct(item, "entry"));
    const rows = map
      .map((item) => ({
        time: Number(item.attrs.key),
        value: vector(item.attrs.value, 3),
      }))
      .sort((a, b) => a.time - b.time);
    if (rows.some((row) => !Number.isFinite(row.time)))
      throw new Error("关键帧时间无效");
    all.set(name, rows);
    return rows;
  }
  maxTime(node, ignoreOverride = false) {
    if (!ignoreOverride && node.attrs.overrideDuration === "true")
      return Number(node.attrs.overrideDurationValue);
    return Math.max(
      0,
      ...[
        "positionByKeyframe",
        "rotationByKeyframe",
        "scaleByKeyframe",
        "elapsedFractionByKeyframe",
      ].flatMap((name) => this.channel(node, name).map((row) => row.time)),
    );
  }
  sampleFrame(node, name, time) {
    const rows = this.channel(node, name);
    if (!rows.length) return name === "scaleByKeyframe" ? [1, 1, 1] : [0, 0, 0];
    let raw;
    const exact = rows.find((row) => row.time === time);
    if (exact) raw = exact.value;
    else if (time <= rows[0].time) raw = rows[0].value;
    else if (time >= rows.at(-1).time) raw = rows.at(-1).value;
    else {
      let hi = rows.findIndex((row) => row.time > time),
        a = rows[hi - 1],
        b = rows[hi],
        fraction = rangeFraction(time, a.time, b.time);
      raw = a.value.map((v, i) =>
        name === "rotationByKeyframe"
          ? angleLerp(v, b.value[i], fraction)
          : v + (b.value[i] - v) * fraction,
      );
    }
    if (name === "scaleByKeyframe") {
      const base = vector(node.attrs.baseScale, 3, [1, 1, 1]);
      return raw.map((v, i) => Math.abs(v) / base[i]);
    }
    if (name === "positionByKeyframe") {
      const base = vector(node.attrs.baseTranslation, 3, [0, 0, 0]);
      return raw.map((v, i) => v + base[i]);
    }
    return [...raw];
  }
  sample(node, name, fraction) {
    return this.sampleFrame(node, name, fraction * this.maxTime(node, true));
  }
  shape(node, key, seen = new Set()) {
    if (seen.has(node)) throw new Error("关键帧形状链接循环");
    const trail = new Set(seen);
    trail.add(node);
    if (
      node.attrs.inputMode === "LINK" &&
      node.attrs.overrideShapeSettings !== "true"
    )
      return this.shape(this.keyframeSource(node), key, trail);
    return node.attrs[key];
  }
  durationMillis(node, seen = new Set()) {
    if (!node) return 0;
    if (this.durationCache.has(node)) return this.durationCache.get(node);
    if (seen.has(node)) throw new Error("动画时长引用循环");
    const trail = new Set(seen);
    trail.add(node);
    const p = this.project;
    let result;
    if (node.type === "MotionKeyframesGraphic") {
      let seconds;
      if (node.attrs.durationMode === "FROM_GRAPHIC")
        seconds = this.durationMillis(p.get(node.attrs.graphic), trail) / 1000;
      else
        seconds = Math.max(
          0,
          ...p.container(node, "motionKeyframes").map((k) => this.maxTime(k)),
        );
      result = Math.trunc(seconds * 1000);
    } else if (node.type === "PlayListGraphic") {
      const durations = p
        .container(node, "entries")
        .map((entry) => this.entryTiming(entry, trail).duration);
      result =
        node.attrs.playbackMode === "SEQUENTIAL"
          ? durations.reduce((a, b) => a + b, 0)
          : Math.max(0, ...durations);
    } else if (node.type === "LinkedGraphic") {
      const target = p.get(node.attrs.graphic);
      result =
        target?.type === "SceneLocation"
          ? 0
          : this.durationMillis(target, trail);
    } else if (node.type === "SpriteSequenceGraphic") {
      const frames = this.sequenceFrames?.(node);
      if (!frames) throw new Error("逐帧图集未加载");
      const fps = Number(node.attrs.framesPerSecond ?? 12);
      if (!(fps > 0)) throw new Error("逐帧播放速率无效");
      result = Math.trunc(f(f(frames.length) / f(fps)) * 1000);
    } else if (node.type === "ShadowGraphic")
      result = Math.max(
        this.durationMillis(p.get(node.attrs.castingGraphic), trail),
        this.durationMillis(p.get(node.attrs.receivingGraphic), trail),
      );
    else if (node.type === "LayeredImageGraphic" || node.type === "HoleGraphic")
      result = 0;
    else if (node.type === "ProgressiveRevealGraphic") result = 1000;
    else if (node.type === "ConditionalOffsetGraphic")
      result = this.durationMillis(p.get(node.attrs.targetGraphic), trail);
    else if (node.type === "ScriptedGraphic") {
      result = this.scriptDurationMillis?.(node);
      if (result == null) throw new Error("脚本图形时长尚未实现");
    } else if (node.type === "ConditionalGraphic")
      result = Math.max(
        0,
        ...String(node.attrs.graphics || "")
          .split(",")
          .filter(Boolean)
          .map((g) => this.durationMillis(p.get(g), trail)),
      );
    else throw new Error(`尚未实现图形时长 ${node.type}`);
    if (!Number.isFinite(result) || result < 0) throw new Error("动画时长无效");
    this.durationCache.set(node, result);
    return result;
  }
  entryTiming(entry, seen = new Set()) {
    const a = entry.attrs,
      target = this.project.get(a.graphic);
    if (!target) throw new Error(`播放条目缺少图形 ${a.graphic}`);
    const intrinsic = Math.trunc(
      f(
        f(
          f(
            Math.abs(Number(a.endFraction ?? 1) - Number(a.startFraction ?? 0)),
          ) * f(this.durationMillis(target, seen)),
        ) * f(Number(a.durationScale ?? 1)),
      ),
    );
    const delay = Number(a.startDelayMillis || 0),
      holdStart = Number(a.holdAtStartMillis || 0),
      holdEnd = Number(a.holdAtEndMillis || 0);
    return {
      target,
      intrinsic,
      delay,
      holdStart,
      holdEnd,
      duration: delay + holdStart + intrinsic + Math.max(0, holdEnd),
    };
  }
  wrapped(entry, fraction) {
    fraction = Math.max(0, fraction);
    const wrapped = fraction % 1;
    return interpFraction(
      entry.attrs.interpFunction,
      wrapped === 0 && fraction >= 1 ? 1 : wrapped,
    );
  }
  entryFraction(entry, progress, timing = this.entryTiming(entry)) {
    const a = entry.attrs,
      { duration, delay, holdStart, holdEnd } = timing;
    let min = 0,
      max = 1;
    if (delay > 0) {
      const point = delay / duration;
      if (progress < point) return interpFraction(a.interpFunction, 0);
      min = point;
    }
    if (holdStart > 0) {
      const point = (delay + holdStart) / duration;
      if (progress <= point)
        return this.wrapped(entry, Number(a.startFraction ?? 0));
      min = point;
    }
    if (holdEnd > 0) {
      max = 1 - holdEnd / duration;
      if (progress >= max)
        return this.wrapped(entry, Number(a.endFraction ?? 1));
    }
    const value = rangeFraction(progress, min, max);
    return this.wrapped(
      entry,
      Number(a.startFraction ?? 0) +
        (Number(a.endFraction ?? 1) - Number(a.startFraction ?? 0)) * value,
    );
  }
  entryAlpha(entry, progress, timing = this.entryTiming(entry)) {
    let value = progress;
    if (timing.delay > 0)
      value = clamp01(rangeFraction(value, timing.delay / timing.duration, 1));
    const fadeIn = Number(entry.attrs.fadeInFraction || 0),
      fadeOut = Number(entry.attrs.fadeOutFraction || 0);
    if (fadeIn > 0 && value < fadeIn) return rangeFraction(value, 0, fadeIn);
    if (timing.holdEnd >= 0 && fadeOut > 0 && 1 - value < fadeOut)
      return clamp01(rangeFraction(value, 1, 1 - fadeOut));
    return 1;
  }
  playlist(graphic, fraction) {
    const p = this.project,
      total = this.durationMillis(graphic),
      sequential = graphic.attrs.playbackMode === "SEQUENTIAL",
      result = [];
    let cursor = 0;
    if (total === 0) fraction = 0;
    for (const entry of p.container(graphic, "entries")) {
      const timing = this.entryTiming(entry),
        min = total ? (sequential ? cursor / total : 0) : 0,
        max = total
          ? sequential
            ? (cursor + timing.duration) / total
            : timing.duration / total
          : 0;
      cursor += timing.duration;
      const indefinite = !sequential && timing.holdEnd < 0;
      if (fraction < min || (fraction > max && !indefinite)) continue;
      const progress = clamp01(rangeFraction(fraction, min, max));
      if (timing.delay > 0 && progress < timing.delay / timing.duration) {
        if (sequential) break;
        continue;
      }
      result.push({
        entry,
        graphic: timing.target,
        fraction: this.entryFraction(entry, progress, timing),
        alpha: this.entryAlpha(entry, progress, timing),
      });
      if (sequential) break;
    }
    return result;
  }
  motionParts(graphic, fraction) {
    const p = this.project,
      target = p.get(graphic.attrs.graphic);
    if (!target) throw new Error(`关键帧缺少目标图形 ${graphic.attrs.graphic}`);
    const targetBounds = graphicBounds(p, target),
      bounds = graphicBounds(p, graphic),
      ortho = vector(graphic.attrs.orthoFrame, 4, [0, 0, 1, 1]);
    const scaleToOutput = graphic.attrs.scaleToOtuput === "true";
    let parentScale = scaleToOutput
      ? [bounds[2] / targetBounds[2], bounds[3] / targetBounds[3]]
      : [1, 1];
    parentScale = parentScale.map((v) => (Math.abs(v - 1) < 0.01 ? 1 : v));
    const result = [],
      maxSeconds = this.durationMillis(graphic) / 1000;
    for (const keyframe of p.container(graphic, "motionKeyframes")) {
      const ownMax = this.maxTime(keyframe),
        partFraction =
          graphic.attrs.durationMode === "FROM_KEYFRAMES"
            ? clamp01(
                rangeFraction(
                  fraction,
                  0,
                  rangeFraction(ownMax, 0, maxSeconds),
                ),
              )
            : fraction;
      const scale = this.sample(keyframe, "scaleByKeyframe", partFraction);
      if (Math.min(scale[0], scale[1]) <= 0.2) continue;
      const relative =
          keyframe.attrs.translationValueMode !== "RELATIVE_TO_CARD",
        size = relative ? [bounds[2], bounds[3]] : [CARD_SIZE, CARD_SIZE];
      const display = (v) => [
        v[0] * size[0] - (relative ? bounds[0] : 0),
        v[1] * size[1] - (relative ? bounds[1] : 0),
        v[2],
      ];
      let position = display(
          this.sample(keyframe, "positionByKeyframe", partFraction),
        ),
        start = display(this.sampleFrame(keyframe, "positionByKeyframe", 0)),
        end = display(this.sampleFrame(keyframe, "positionByKeyframe", ownMax));
      if (
        graphic.attrs.pixelSnapEnabled === "true" &&
        (distance3(position, start) < 0.001 || distance3(position, end) < 0.001)
      )
        position = [
          roundEven(position[0]),
          roundEven(position[1]),
          position[2],
        ];
      if (graphic.attrs.translationKeyframeMode === "RELATIVE_TO_START")
        position = position.map((v, i) => v - start[i]);
      else if (graphic.attrs.translationKeyframeMode === "RELATIVE_TO_END")
        position = position.map((v, i) => v - end[i]);
      let rotation = this.sample(
        keyframe,
        "rotationByKeyframe",
        partFraction,
      )[2];
      if (graphic.attrs.rotationKeyframeMode === "RELATIVE_TO_START")
        rotation -= this.sampleFrame(keyframe, "rotationByKeyframe", 0)[2];
      else if (graphic.attrs.rotationKeyframeMode === "RELATIVE_TO_END")
        rotation -= this.sampleFrame(keyframe, "rotationByKeyframe", ownMax)[2];
      const cutout = vector(
          this.shape(keyframe, "cutoutBounds"),
          4,
          [0, 0, 1, 1],
        ),
        subImage =
          cutout.some((v, i) => v !== [0, 0, 1, 1][i]) &&
          this.durationMillis(target) === 0;
      const originValue = this.shape(keyframe, "shapeOrigin"),
        origin = originValue ? vector(originValue, 3) : null,
        partScale = [scale[0] * parentScale[0], scale[1] * parentScale[1]];
      let offset = [0, 0];
      if (origin) {
        const shapeRelative =
            keyframe.attrs.shapeOriginValueMode !== "RELATIVE_TO_CARD",
          shapeSize = shapeRelative
            ? [targetBounds[2], targetBounds[3]]
            : [CARD_SIZE, CARD_SIZE],
          ox = Math.trunc(origin[0] * shapeSize[0]),
          oy = Math.trunc(origin[1] * shapeSize[1]);
        let cropOrigin;
        if (subImage)
          cropOrigin = [
            targetBounds[2] * cutout[0],
            targetBounds[3] * cutout[1],
          ];
        else {
          const ref = shapeRelative
            ? targetBounds
            : [0, 0, CARD_SIZE, CARD_SIZE];
          cropOrigin = [
            ref[0] + ref[2] * cutout[0],
            ref[1] + ref[3] * cutout[1],
          ];
        }
        offset = [
          Math.trunc(partScale[0] * Math.trunc(cropOrigin[0] - ox)),
          Math.trunc(partScale[1] * Math.trunc(cropOrigin[1] - oy)),
        ];
      }
      const cs = Math.cos(rotation),
        sn = Math.sin(rotation);
      let matrix = multiply2(affine(1, 1, position[0], position[1]), [
        cs,
        sn,
        -sn,
        cs,
        0,
        0,
      ]);
      matrix = multiply2(matrix, affine(1, 1, ...offset));
      matrix = multiply2(matrix, affine(...partScale));
      const targetFraction = this.channel(keyframe, "elapsedFractionByKeyframe")
        .length
        ? this.sample(keyframe, "elapsedFractionByKeyframe", partFraction)[0]
        : fraction;
      result.push({
        keyframe,
        target,
        matrix,
        cutout: subImage ? cutout : null,
        fraction: targetFraction,
        targetBounds,
        partFraction,
      });
    }
    return result;
  }
}
const distance3 = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
