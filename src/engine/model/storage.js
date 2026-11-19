import { STORY_PHASES } from "./board.js";
export const SAVE_KEY = "gorogoa-web-progress-v1";
const FORMAT = "gorogoa-web-save-v1";
export function snapshot(state) {
  return {
    format: FORMAT,
    project: state.project.tree.attrs.guid,
    locations: [...state.locations],
    states: [...state.states],
    inPlay: [...state.inPlay],
    coords: [...state.coords],
    captors: [...state.captors],
    captureSides: [...(state.captureSides || new Map())],
    ...(state.storyPhase === undefined ? {} : { storyPhase: state.storyPhase }),
  };
}
export function restore(state, data) {
  const p = state.project;
  if (data?.format !== FORMAT || data.project !== p.tree.attrs.guid)
    throw new Error("存档版本或项目不匹配");
  if (data.storyPhase !== undefined && !STORY_PHASES.includes(data.storyPhase))
    throw new Error("存档剧情阶段无效");
  const pairs = (name) => {
    if (!Array.isArray(data[name])) throw new Error(`存档缺少${name}`);
    const map = new Map();
    for (const pair of data[name]) {
      if (!Array.isArray(pair) || pair.length !== 2 || map.has(pair[0]))
        throw new Error(`存档${name}条目无效`);
      map.set(...pair);
    }
    return map;
  };
  const locations = pairs("locations"),
    states = pairs("states"),
    coords = pairs("coords"),
    captors = pairs("captors"),
    captureSides = pairs("captureSides");
  const card = (guid) => p.get(guid)?.type === "Card";
  for (const [guid, location] of locations)
    if (
      !card(guid) ||
      p.get(location)?.type !== "SceneLocation" ||
      p.owner(p.get(location), "Card")?.attrs.guid !== guid
    )
      throw new Error("存档位置引用无效");
  for (const [guid, value] of states)
    if (state.stateOwners.get(value)?.attrs.guid !== guid)
      throw new Error("存档状态引用无效");
  if (
    states.size !== state.states.size ||
    locations.size !== state.locations.size
  )
    throw new Error("存档状态不完整");
  if (
    !Array.isArray(data.inPlay) ||
    data.inPlay.some((guid) => !card(guid)) ||
    new Set(data.inPlay).size !== data.inPlay.length
  )
    throw new Error("存档卡片集合无效");
  for (const [guid, point] of coords)
    if (
      !card(guid) ||
      !Array.isArray(point) ||
      point.length !== 2 ||
      point.some((v) => !Number.isInteger(v) || v < 0 || v > 1)
    )
      throw new Error("存档格子位置无效");
  for (const [guid, captor] of captors) {
    if (!card(guid) || !card(captor) || guid === captor)
      throw new Error("存档叠层关系无效");
    const seen = new Set([guid]);
    let current = captor;
    while (current) {
      if (seen.has(current)) throw new Error("存档叠层循环");
      seen.add(current);
      current = captors.get(current);
    }
  }
  for (const [child, side] of captureSides)
    if (!captors.has(child) || !["OVER", "UNDER"].includes(side))
      throw new Error("存档捕获方向无效");
  if ([...captors.keys()].some((child) => !captureSides.has(child)))
    throw new Error("存档缺少捕获方向");
  // 全部校验通过才替换，损坏存档不影响正在玩的状态。
  state.locations = locations;
  state.states = states;
  state.coords = coords;
  state.captors = captors;
  state.captureSides = captureSides;
  state.inPlay = new Set(data.inPlay);
  state.storyPhase = data.storyPhase;
  state.hovered.clear();
  state.targets.clear();
  state.activeLinks.clear();
  state.version++;
  return state;
}
export function readSave(storage, key, state) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return false;
    restore(state, JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}
export function writeSave(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify(snapshot(state)));
    return true;
  } catch {
    return false;
  }
}
