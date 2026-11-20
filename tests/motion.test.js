import { afterEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { ManualTimeline } from "../src/game/timeline.js";
import { GameMotion } from "../src/game/motion.js";
import { engine } from "animejs/engine";
import { ProjectModel } from "../src/engine/model/project.js";
import {
  planTransition,
  sampleTransition,
} from "../src/engine/model/navigation.js";
import {
  BOARD_INSET,
  CELLS,
  chapterOpening,
  chapterClosing,
  sampleCardDrop,
  cellPosition,
  planCardDrop,
} from "../src/engine/model/board.js";
import { CARD_SIZE } from "../src/engine/render/camera.js";

const project = new ProjectModel(
  JSON.parse(
    (
      await readFile("public/assets/data/runtime-project.json", "utf8")
    ).trimStart(),
  ),
);
const plans = project
  .all("LocationTransition")
  .filter((node) => project.get(node.attrs.destLocation))
  .map((node) => planTransition(project, node));
const running = [];
const noop = Object.fromEntries(
  ["navigation", "flight", "opening", "closing"].map((type) => [
    type,
    () => {},
  ]),
);
function controller(callbacks = {}) {
  const motion = new GameMotion({ ...noop, ...callbacks });
  running.push(motion);
  return motion;
}
afterEach(() => {
  for (const motion of running.splice(0)) motion.cancel();
});
function near(actual, expected) {
  if (typeof expected === "number") expect(actual).toBeCloseTo(expected, 8);
  else if (Array.isArray(expected))
    expected.forEach((value, i) => near(actual[i], value));
  else if (expected && typeof expected === "object")
    for (const key of Object.keys(expected)) near(actual[key], expected[key]);
  else expect(actual).toBe(expected);
}
const fractions = [
  -0.1,
  0,
  1e-9,
  0.25,
  0.5,
  0.6 - 1e-10,
  0.6,
  0.6 + 1e-10,
  1 - 1e-10,
  1 - 1e-14,
  1,
  1.1,
];

// 不改全局精度，用普通对象验证数字补间与静默 seek。
test("共享时间线统一秒单位、线性采样和静默跳转，且不注册 RAF", () => {
  const raf = vi.spyOn(globalThis, "requestAnimationFrame");
  const values = { progress: 0, precise: 0 };
  const timeline = new ManualTimeline(values).add(
    { progress: [0, 1], precise: [0, 0.123456789012345] },
    2,
    1,
  );
  const completed = (timeline.animation.onComplete = vi.fn());
  expect(timeline.animation.paused).toBe(true);
  expect(timeline.animation.duration).toBe(3000);
  for (const [time, progress] of [
    [0, 0],
    [1, 0],
    [1.5, 0.25],
    [2, 0.5],
    [3, 1],
    [1.5, 0.25],
  ]) {
    expect(timeline.seek(time)).toBe(values);
    expect(values.progress).toBe(progress);
    expect(values.precise).toBeCloseTo(0.123456789012345 * progress, 14);
  }
  expect(completed).not.toHaveBeenCalled();
  expect(timeline.animation.paused).toBe(true);
  expect(raf).not.toHaveBeenCalled();
  expect(engine.useDefaultMainLoop).toBe(false);
  expect(engine.reqId).toBe(0);
});

test("全部有效导航与纯采样一致，包括原版反向关键帧、起始帧及端点附近", () => {
  expect(plans.filter((plan) => plan.keyframes.length)).toHaveLength(14);
  expect(plans.some((plan) => plan.reverse && plan.keyframes.length)).toBe(
    true,
  );
  for (const plan of plans) {
    const motion = controller();
    const move = motion.start(
      "navigation",
      { plan, card: "card", destination: plan.destination.attrs.guid },
      0,
    );
    near(move.sample, sampleTransition(plan, 0));
    for (const fraction of fractions) {
      const elapsed = fraction * plan.durationSeconds;
      motion.update(elapsed);
      near(move.sample, sampleTransition(plan, elapsed));
    }
    expect(motion.busy).toBe(false);
  }
});

test.each(CELLS)("章节入场及出场与纯采样一致：格子 %j", (col, row) => {
  const cell = [col, row];
  for (const [type, duration, sample] of [
    ["opening", 2, chapterOpening],
    ["closing", 3, (elapsed) => chapterClosing(cell, elapsed)],
  ]) {
    const motion = controller();
    const move = motion.start(type, { guid: "card", cell }, 0);
    near(move.sample, sample(0));
    for (const fraction of fractions) {
      motion.update(fraction * duration);
      near(move.sample, sample(fraction * duration));
      expect(move.sample.position).toEqual(
        sample(fraction * duration).position,
      );
    }
    expect(motion.busy).toBe(false);
  }
});

const dropPlans = [0.1, 0.137, 0.35].flatMap((duration) =>
  [null, { guid: "other", from: CELLS[1], to: CELLS[0] }].map((shuffle) => ({
    duration,
    cell: CELLS[1],
    destination: cellPosition(CELLS[1]),
    topLeft: [19.7, -23.2],
    shuffle,
  })),
);
test.each(dropPlans)(
  "落卡及交换保持原版整数截断：时长 $duration，交换 $shuffle",
  (plan) => {
    const motion = controller();
    const move = motion.start(
      "flight",
      { drag: { draggedGUID: "card" }, plan },
      0,
    );
    for (const fraction of fractions) {
      motion.update(fraction * plan.duration);
      expect(move.sample).toEqual(
        sampleCardDrop(plan, fraction * plan.duration),
      );
    }
  },
);

test("落卡时长保留距离截断、上下限及交换优先规则", () => {
  const state = { coords: new Map(), captors: new Map() };
  const links = { state, enabled: [], active: [], refresh() {} };
  const drag = { draggedGUID: "card", from: CELLS[0] };
  for (const [topLeft, duration] of [
    [[8, 8], 0.1],
    [[70.4, 8], 0.124],
    [[-200, 8], 0.35],
  ]) {
    expect(planCardDrop(links, drag, topLeft).duration).toBe(duration);
  }
  state.coords.set("other", CELLS[1]);
  const plan = planCardDrop(links, drag, cellPosition(CELLS[1]));
  expect(plan.shuffle).toEqual({ guid: "other", from: CELLS[1], to: CELLS[0] });
  expect(plan.duration).toBe(0.35);
});

test("零时长导航下一次更新才提交，跳帧按导航、落卡、入场、出场完成且只提交一次", () => {
  const events = [];
  const motion = controller(
    Object.fromEntries(
      ["navigation", "flight", "opening", "closing"].map((type) => [
        type,
        (move) => events.push([type, move]),
      ]),
    ),
  );
  const plan = { ...plans[0], durationSeconds: 0 };
  const nav = motion.start("navigation", { plan, card: "nav" }, 10);
  expect(nav.sample.complete).toBe(true);
  expect(events).toEqual([]);
  expect(motion.busy).toBe(true);
  motion.start(
    "flight",
    { plan: dropPlans[0], drag: { draggedGUID: "card" } },
    10,
  );
  motion.start("opening", { guid: "open", cell: CELLS[0] }, 10);
  motion.start("closing", { guid: "close", cell: CELLS[1] }, 10);
  motion.update(20);
  expect(events.map(([type]) => type)).toEqual([
    "navigation",
    "flight",
    "opening",
    "closing",
  ]);
  expect(motion.busy).toBe(false);
  expect(motion.update(20)).toBe(false);
  expect(motion.update(100)).toBe(false);
  expect(events).toHaveLength(4);
});

test("绘制坐标与脚本坐标保持 closing 排除规则", () => {
  const motion = controller();
  const flight = motion.start(
    "flight",
    { plan: dropPlans[1], drag: { draggedGUID: "card" } },
    0,
  );
  const opening = motion.start("opening", { guid: "open", cell: CELLS[0] }, 0);
  const closing = motion.start("closing", { guid: "close", cell: CELLS[1] }, 0);
  motion.update(0.05);
  expect(motion.position("card")).toEqual(flight.sample.dragged);
  expect(motion.position("other")).toEqual(flight.sample.shuffled);
  expect(motion.position("open")).toEqual(opening.sample.position);
  expect(motion.position("close")).toEqual(closing.sample.position);
  expect(motion.displayCoords("close")).toBeUndefined();
  expect(motion.displayCoords("card")).toEqual(
    flight.sample.dragged.map((value) => (value - BOARD_INSET) / CARD_SIZE),
  );
  const drag = { draggedGUID: "card", topLeft: [43, 78] };
  expect(motion.displayCoords("card", drag)).toEqual([0.1, 0.2]);
});

test("取消及重建不会提交旧动画，完成回调开启的新动画不会被旧清理移除", () => {
  const complete = vi.fn();
  const motion = controller({ opening: complete });
  motion.start("opening", { guid: "old" }, 0);
  motion.update(1);
  motion.cancel();
  expect(motion.busy).toBe(false);
  motion.update(100);
  expect(complete).not.toHaveBeenCalled();
  const replacement = motion.start("opening", { guid: "new" }, 100);
  motion.update(100);
  expect(replacement.sample).toEqual(chapterOpening(0));
  motion.update(102);
  expect(complete).toHaveBeenCalledExactlyOnceWith(replacement);
  motion.start("opening", { guid: "first" }, 200);
  const second = motion.start("opening", { guid: "second" }, 200);
  expect(motion.opening).toBe(second);
  motion.onComplete.opening = (move) => {
    complete(move);
    motion.update(202);
    motion.start("opening", { guid: "third" }, 202);
  };
  motion.update(202);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenLastCalledWith(second);
  expect(motion.opening.guid).toBe("third");
});

test("预取纯采样不推进正在播放的运动", () => {
  const plan = plans.find((plan) => plan.durationSeconds > 0);
  const motion = controller();
  const move = motion.start("navigation", { card: "card", plan }, 10);
  motion.update(10 + plan.durationSeconds / 4);
  const sample = move.sample;
  for (let i = 0; i < 4; i++) sampleTransition(plan, plan.durationSeconds / 2);
  expect(move.sample).toBe(sample);
  expect(motion.navigation).toBe(move);
});
