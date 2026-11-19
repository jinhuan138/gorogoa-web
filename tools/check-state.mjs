import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ProjectModel } from "../src/engine/project.js";
import { RuntimeState, evaluateFormula } from "../src/engine/state.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  read = (f) =>
    JSON.parse(
      fs.readFileSync(path.join(root, f), "utf8").replace(/^\uFEFF/, ""),
    );
assert.equal(evaluateFormula("a&b|c", { a: false, b: true, c: true }), false);
assert.equal(evaluateFormula("!a&b", { a: false, b: false }), true);
assert.equal(evaluateFormula("(a&b)|c", { a: false, b: true, c: true }), true);
assert.equal(evaluateFormula("missing", { a: true }), false);
assert.equal(evaluateFormula("a&unknown", { a: true, unknown: null }), null);
const project = new ProjectModel(
  read("public/assets/data/runtime-project.json"),
);
let blocked = false;
const state = new RuntimeState(project, { animationComplete: () => !blocked });
const card = project.get(project.tree.attrs.staringCard),
  sd = project.get("REFsd-1bd0b64f-31e3-4186-8cb5-985d2d4cbc16");
assert.equal(project.get(state.states.get(sd.attrs.guid)).attrs.id, "init");
assert.equal(
  project.get(state.locations.get(card.attrs.guid)).attrs.id,
  "city1a000",
);
state.coords.set(card.attrs.guid, [0, 0]);
state.step();
assert.equal(project.get(state.states.get(sd.attrs.guid)).attrs.id, "init");
state.hovered.add(card.attrs.guid);
state.onChange = (change) => {
  if (change.container === sd && change.state.attrs.id === "sd_arrives")
    blocked = true;
};
state.step();
assert.equal(
  project.get(state.states.get(sd.attrs.guid)).attrs.id,
  "sd_arrives",
);
blocked = false;
state.step();
assert.equal(project.get(state.states.get(sd.attrs.guid)).attrs.id, "sd_waits");
const archPredicate = project.get(
    "state0-c886b54f-fe2c-4436-9652-15ce8e221f4e",
  ),
  archCard = project.owner(archPredicate, "Card");
assert.ok(archCard);
assert.equal(project.getAll(archPredicate.attrs.subject).length, 0);
assert.equal(
  state.isSatisfied(archPredicate),
  false,
  "失效引用回落到所属卡；卡片还未入场",
);
state.inPlay.add(archCard.attrs.guid);
assert.equal(
  state.isSatisfied(archPredicate),
  true,
  "入场后原版拱门叠合条件必须通过",
);
state.applyCheckpoint(read("public/assets/data/runtime-chapter1-save.json"));
assert.equal(
  project.get(state.locations.get(card.attrs.guid)).attrs.id,
  "bowl_close",
);
console.log(
  "状态检查通过：原版右结合公式、缺变量false、失效引用回落所属卡、初始状态、鼠标入场、动画完成门控、章节检查点。",
);

// 原项目真实状态：前一个不可打断转移不能挡住后面的可打断转移。
const lampLoop = project.get(
  "lamp thought loop-8460ae9f-2892-4fe1-87ad-c40a9040ed70",
);
const lampContainer = project.owner(lampLoop, "SceneLayer");
const lampCondition = project.get("init-48cc2e34-fb66-46eb-a993-c10064877d76");
const lampConditionOwner = state.stateOwners.get(lampCondition.attrs.guid);
const lampOtherState = project
  .container(lampConditionOwner, "states")
  .find((node) => node !== lampCondition);
assert.ok(lampOtherState);
const lamp = new RuntimeState(project, { animationComplete: () => false });
lamp.containers = [lampContainer];
lamp.setState(lampContainer, lampLoop);
lamp.setState(lampConditionOwner, lampOtherState);
const lampChanges = lamp.step();
assert.equal(
  lampChanges[0]?.transition,
  "transition 1-7cf624eb-e393-4f12-8c33-ce24e7167636",
);
assert.equal(
  lampChanges[0].state,
  "relit-4c1a838d-614b-4b54-9d5e-68df786da07f",
);

const flutter = project.get("flutter-bf2ecd4f-5298-4934-baa1-b683d868fd55"),
  flutterContainer = project.owner(flutter, "SceneLayer"),
  dark = project.get("darkness-9edc18fa-c229-4fda-af6f-7603c79ce9e6");
const moth = new RuntimeState(project, { animationComplete: () => false });
moth.containers = [flutterContainer];
moth.setState(flutterContainer, flutter);
moth.setState(moth.stateOwners.get(dark.attrs.guid), dark);
const mothChanges = moth.step();
assert.equal(
  mothChanges[0]?.transition,
  "transition 1-7aea9ec0-e5ad-4888-bf63-3b275403237d",
);
assert.equal(
  mothChanges[0].state,
  "darkness-608ce2f1-57f7-42ed-bb26-59c1a403ebfc",
);

// 原项目自循环必须发重新进入通知并重启动画；新动画未完成时不能再循环。
let loopComplete = true,
  loopEvents = 0;
const loop = new RuntimeState(project, {
  animationComplete: () => loopComplete,
});
loop.containers = [lampContainer];
loop.setState(lampContainer, lampLoop);
loop.setState(lampConditionOwner, lampCondition);
loop.onChange = (event) => {
  if (event.container === lampContainer) {
    loopEvents++;
    loopComplete = false;
  }
};
const beforeLoopVersion = loop.version,
  loopChanges = loop.step();
assert.equal(loopChanges.length, 1);
assert.equal(
  loopChanges[0].transition,
  "transition-4500be93-d970-4079-872c-a9434c38ee8c",
);
assert.equal(loopChanges[0].state, lampLoop.attrs.guid);
assert.equal(loopEvents, 1);
assert.ok(loop.version > beforeLoopVersion);
assert.equal(loop.step().length, 0);
loopComplete = true;
assert.equal(loop.step().length, 1);
assert.equal(loopEvents, 2);

// 无状态变化的重复赋值不重启，显式 reenter 会通知；检查点367条状态均恢复。
let duplicateEvents = 0;
loop.onChange = () => duplicateEvents++;
assert.equal(loop.setState(lampContainer, lampLoop), false);
assert.equal(duplicateEvents, 0);
assert.equal(loop.setState(lampContainer, lampLoop, { reenter: true }), true);
assert.equal(duplicateEvents, 1);
const checkpoint = read("public/assets/data/runtime-chapter1-save.json");
for (const savedCard of project.container(checkpoint, "cards", "CardSaveData"))
  for (const map of project.container(savedCard, "stateGUIDMap"))
    for (const entry of project.direct(map, "entry"))
      assert.equal(state.states.get(entry.attrs.key), entry.attrs.value);

// 真实开场初始 SceneLayer没有播放动画，鼠标覆盖才进入arrival；在全局30秒激活仍应播完整8秒。
const { SceneRenderer } = await import("../src/engine/renderer.js");
const clocks = new Map(),
  ready = new Map();
let intro;
intro = new RuntimeState(project, {
  animationComplete: (container) => {
    const known = ready.get(container.attrs.guid);
    return known
      ? known.state === intro.states.get(container.attrs.guid)
        ? known.complete
        : null
      : true;
  },
  onChange: (event) => {
    if (event.kind === "state" && event.container.type === "SceneLayer")
      ready.set(event.container.attrs.guid, {
        state: event.state.attrs.guid,
        complete: null,
      });
  },
});
intro.containers = [sd];
intro.coords.set(card.attrs.guid, [0, 0]);
const renderer = new SceneRenderer(
  project,
  read("public/assets/manifest.json"),
  read("public/assets/data/atlases.json"),
  { isSatisfied: (node) => intro.isSatisfied(node) },
);
assert.equal(intro.step().length, 0);
intro.hovered.add(card.attrs.guid);
intro.step();
assert.equal(
  project.get(intro.states.get(sd.attrs.guid)).attrs.id,
  "sd_arrives",
);
const stale = renderer.buildDrawList(intro.locations.get(card.attrs.guid), {
  timeSeconds: 30,
  graphicTimes: clocks,
});
const arrivalGuid = project
  .all("PlayListGraphic")
  .find((node) => node.attrs.id === "sd_arrives").attrs.guid;
assert.equal(
  stale.animations.find((a) => a.guid === arrivalGuid).complete,
  true,
  "新时钟缺失的报告以旧零时刻采样，必须丢弃",
);
for (const animation of stale.animations)
  if (!clocks.has(animation.guid)) clocks.set(animation.guid, 30);
const fresh = renderer.buildDrawList(intro.locations.get(card.attrs.guid), {
  timeSeconds: 30,
  graphicTimes: clocks,
});
assert.equal(
  fresh.animations.find((a) => a.guid === arrivalGuid).complete,
  false,
);
assert.equal(
  fresh.animations.find((a) => a.guid === arrivalGuid).elapsedSeconds,
  0,
);
ready.set(sd.attrs.guid, {
  state: intro.states.get(sd.attrs.guid),
  complete: fresh.animations
    .filter((a) => a.sceneLayerGUID === sd.attrs.guid)
    .every((a) => a.complete),
});
assert.equal(intro.step().length, 0);
const completeReport = renderer.buildDrawList(
  intro.locations.get(card.attrs.guid),
  { timeSeconds: 38, graphicTimes: clocks },
);
assert.equal(
  completeReport.animations.find((a) => a.guid === arrivalGuid).complete,
  true,
);
ready.set(sd.attrs.guid, {
  state: intro.states.get(sd.attrs.guid),
  complete: true,
});
intro.step();
assert.equal(project.get(intro.states.get(sd.attrs.guid)).attrs.id, "sd_waits");
assert.ok(
  intro
    .getTransitions(card.attrs.guid)
    .some((t) => t.attrs.hotspotStyle === "BACK_BUTTON"),
);
console.log(
  "真实项目回归通过：lamp/flutter后候选interrupt、自循环重新激活、367状态检查点、30秒迟激活完整8秒入场及BACK按钮条件。",
);

// 两种原版构造器均将 m_predicateOperator 初始化为 1（ALL）。
const defaults = new RuntimeState(project);
defaults.isSatisfied = (node) => node.attrs.id === "true-case";
for (const type of ["CompoundPredicate", "StateTransition"]) {
  const definition = {
    type,
    attrs: {},
    children: [
      {
        type: "predicates",
        attrs: {},
        children: [
          { type: "AtomicPredicate", attrs: { id: "true-case" }, children: [] },
          {
            type: "AtomicPredicate",
            attrs: { id: "false-case" },
            children: [],
          },
        ],
      },
    ],
  };
  assert.equal(
    defaults.evaluatePredicates(definition),
    false,
    `${type} 缺省 operator 必须按原版构造器 ALL，不能 ANY`,
  );
}
console.log("缺省谓词组合检查通过：原版构造器默认 ALL。");

// 原版GridCoords字符串为row,col；网页内部统一col,row，须用非对称坐标检验。
const eastRequired = project.get(
    "predicate-76fc0eb8-7794-4471-a7ba-e98ffbbe3bc5",
  ),
  southRequired = project.get("predicate-5253fa71-d492-4236-9178-89e6d7d315bd");
assert.equal(eastRequired.attrs.requiredCoords, "0.0,1.0");
assert.equal(southRequired.attrs.requiredCoords, "1.0,0.0");
const coordinates = new RuntimeState(project),
  coordinateCard = eastRequired.attrs.subject;
assert.equal(project.get(coordinateCard).type, "Card");
coordinates.coords.set(coordinateCard, [1, 0]);
assert.equal(
  coordinates.isSatisfied(eastRequired),
  true,
  "原row0,col1应匹配网页col1,row0",
);
assert.equal(coordinates.isSatisfied(southRequired), false);
coordinates.coords.set(coordinateCard, [0, 1]);
assert.equal(coordinates.isSatisfied(eastRequired), false);
assert.equal(coordinates.isSatisfied(southRequired), true);
const defaultCoords = structuredClone(eastRequired);
delete defaultCoords.attrs.requiredCoords;
assert.equal(coordinates.isSatisfied(defaultCoords), false);
coordinates.coords.set(coordinateCard, [0, 0]);
assert.equal(
  coordinates.isSatisfied(defaultCoords),
  true,
  "原版缺省谓词坐标是左上格",
);
coordinates.coords.delete(coordinateCard);
assert.equal(coordinates.isSatisfied(defaultCoords), false);
const captorPredicate = structuredClone(eastRequired);
captorPredicate.attrs.cardStatus = "CAPTOR_AT_COORDS";
const captorCard = card.attrs.guid;
coordinates.captors.set(coordinateCard, captorCard);
coordinates.coords.set(captorCard, [1, 0]);
assert.equal(coordinates.isSatisfied(captorPredicate), true);
coordinates.coords.set(captorCard, [0, 1]);
assert.equal(coordinates.isSatisfied(captorPredicate), false);
const rowColCheckpoint = new RuntimeState(project);
rowColCheckpoint.applyCheckpoint(checkpoint);
const asymmetricCard = project
  .container(checkpoint, "cards", "CardSaveData")
  .find((entry) => entry.attrs.gridCoords === "0,1");
assert.ok(asymmetricCard);
assert.deepEqual(
  rowColCheckpoint.coords.get(asymmetricCard.attrs.cardGUID),
  [1, 0],
  "真实原版checkpoint row0,col1须转成网页col1,row0",
);
const { snapshot, restore } = await import("../src/engine/storage.js");
const internalSnapshot = snapshot(rowColCheckpoint),
  roundtrip = new RuntimeState(project);
restore(roundtrip, internalSnapshot);
assert.deepEqual(
  roundtrip.coords.get(asymmetricCard.attrs.cardGUID),
  [1, 0],
  "网页自身save已是col,row，不能二次转置",
);
console.log(
  "非对称坐标检查通过：原版requiredCoords/检查点row,col转置，Card本体条件，CAPTOR坐标与网页存档不二次转置。",
);
