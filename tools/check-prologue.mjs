// Exercise the real game entry, original data and input handlers without starting a browser or a build.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2),
  basePath = args.find((arg) => !arg.startsWith("--"));
const root = basePath
  ? pathToFileURL(resolve(basePath) + "/")
  : new URL("../", import.meta.url);
const endOnly = args.includes("--ending");
const menuOnly = args.includes("--chapter-menu");
const creditBytes = await readFile(
  new URL("public/assets/data/credits.json", root),
);
const chapterBytes = menuOnly
  ? await readFile(
      new URL("public/assets/data/runtime-chapter2-save.json", root),
    )
  : null;
const siteUrl = "https://gorogoa.test/owner/repo/";
const sitePath = new URL(siteUrl).pathname;
let time = 0,
  frame;
const WIDTH = 716;
const store = new Map();
const pixelCalls = { images: 0 };
function drawing() {
  const context = {
    globalAlpha: 1,
    drawImage() {
      pixelCalls.images++;
    },
  };
  const stack = [];
  context.save = () => stack.push(context.globalAlpha);
  context.restore = () => {
    assert.ok(stack.length);
    context.globalAlpha = stack.pop();
  };
  return new Proxy(context, {
    get(target, key) {
      return key in target ? target[key] : () => {};
    },
  });
}
class Element extends EventTarget {
  children = [];
  style = { setProperty() {} };
  dataset = {};
  attrs = {};
  hidden = false;
  textContent = "";
  width = 700;
  height = 700;
  context = drawing();
  getContext(type) {
    return type === "2d" ? this.context : null;
  }
  setAttribute(key, value) {
    this.attrs[key] = value;
  }
  focus() {}
  querySelector(selector) {
    if (selector === '[aria-pressed="true"]')
      return (
        this.children.find((child) => child.attrs["aria-pressed"] === "true") ??
        null
      );
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: WIDTH, height: WIDTH };
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(child) {
    this.children.push(child);
  }
  setPointerCapture() {}
}
const ids = Object.fromEntries(
  [
    "game",
    "hotspots",
    "loading",
    "notice",
    "board",
    "hint",
    "sound",
    "ending",
    "credits",
    "credits-page",
    "credits-prev",
    "credits-next",
    "pause",
    "game-menu",
    "menu-controls",
    "chapter-panel",
    "chapter-list",
    "menu-confirm",
    "menu-ok",
    "menu-cancel",
    "menu-action",
    "volume-music",
    "volume-effects",
    "startup",
    "game-shell",
    "show-hints",
    "game-fullscreen",
    "settings-status",
    "settings-credits",
    "settings-credits-lines",
    "language-panel",
    "language-list",
    "language-open",
    "language-back",
    "settings-credits-back",
    "exit-game",
    "title-panel",
    "title-resume",
  ].map((id) => [id, new Element()]),
);
ids["game-menu"].hidden = true;
globalThis.document = {
  baseURI: siteUrl,
  body: new Element(),
  documentElement: new Element(),
  getElementById: (id) => ids[id],
  createElement: () => new Element(),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.localStorage = {
  getItem: (key) => store.get(key),
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
};
globalThis.performance = { now: () => time * 1000 };
globalThis.requestAnimationFrame = (callback) => {
  assert.equal(frame, undefined);
  frame = callback;
};
globalThis.OffscreenCanvas = Element;
globalThis.Image = class {
  style = {};
  async decode() {
    assert.ok(this.src.startsWith(siteUrl + "assets/textures/"));
  }
};
globalThis.fetch = async (url) => {
  const pathname = new URL(url).pathname;
  assert.ok(pathname.startsWith(sitePath + "assets/"));
  const path = pathname.slice(sitePath.length - 1);
  if (path === "/assets/data/credits.json") return new Response(creditBytes);
  if (chapterBytes && path === "/assets/data/runtime-chapter2-save.json")
    return new Response(chapterBytes);
  return new Response(
    await readFile(fileURLToPath(new URL("public" + path, root))),
  );
};

const errors = [];
console.error = (...args) => errors.push(args);
const { SceneRenderer } = await import(
  new URL("src/engine/renderer.js", root).href
);
const { RuntimeState } = await import(
  new URL("src/engine/state.js", root).href
);
const stepState = RuntimeState.prototype.step;
let liveState;
RuntimeState.prototype.step = function (...args) {
  liveState = this;
  return stepState.apply(this, args);
};
let endingDraws = 0,
  endingUploads = 0;
const gl = new Proxy(
  {
    TEXTURE0: 1000,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    texImage2D() {
      endingUploads++;
    },
    drawArrays() {
      endingDraws++;
    },
  },
  {
    get(target, key) {
      return target[key] ?? (() => {});
    },
  },
);
Object.assign(ids.ending, {
  clientWidth: 1000,
  clientHeight: 800,
  getContext: (type) => (type === "webgl" ? gl : null),
});
if (endOnly || menuOnly) {
  const [{ loadProject, loadChapterCheckpoint }, { snapshot }] =
    await Promise.all(
      ["project", "storage"].map(
        (name) => import(new URL(`src/engine/${name}.js`, root).href),
      ),
    );
  const { project } = await loadProject(document.baseURI);
  const checkpoint = new RuntimeState(project);
  checkpoint.applyCheckpoint(
    await loadChapterCheckpoint(endOnly ? "end" : 5, document.baseURI),
  );
  store.set("gorogoa-web-progress-v1", JSON.stringify(snapshot(checkpoint)));
  if (menuOnly) store.set("gorogoa-web-unlocked-chapter", "5");
}
const actualRender = SceneRenderer.prototype.render;
const bowlPartWarnings = [],
  bowlPartDraws = new Set();
const bowlParts = ["_balloon_kf-2f10cecf", "_bowl_kf-06ad4bbe"];
const relevant = (guid) => bowlParts.some((prefix) => guid?.startsWith(prefix));
function collectBowlParts(drawn) {
  for (const item of drawn) {
    if (relevant(item.guid) && item.part) bowlPartDraws.add(item.guid);
    for (const key of ["children", "mask", "caster", "receiver"])
      if (item[key]) collectBowlParts(item[key]);
  }
}
SceneRenderer.prototype.render = async function (...args) {
  const report = await actualRender.call(this, ...args);
  bowlPartWarnings.push(
    ...report.unsupported.filter((issue) => relevant(issue.guid)),
  );
  collectBowlParts(report.drawn);
  return report;
};
const app = new URL("src/game.js", root);
await import(app.href);
async function step(count = 1, delta = 0.25) {
  for (let i = 0; i < count; i++) {
    time += delta;
    assert.ok(frame, "游戏没有安排下一帧");
    const next = frame;
    frame = undefined;
    await next();
    assert.deepEqual(errors, []);
  }
}
const emit = (type, x, y, buttons = 0) => {
  const event = new Event(type);
  Object.assign(event, {
    clientX: x,
    clientY: y,
    isPrimary: true,
    button: 0,
    buttons,
    pointerId: 1,
  });
  ids.board.dispatchEvent(event);
};
const locs = () => ids.game.dataset.locations?.split("|") ?? [];
const center = [183, 183],
  upperLeft = [8, 8],
  upperRight = [358, 8];
function hotspot(position, fx, fy) {
  const [x, y] = [position[0] + 350 * fx, position[1] + 350 * fy];
  return ids.hotspots.children.find((button) => {
    const [left, top, width, height] = ["left", "top", "width", "height"].map(
      (key) => (parseFloat(button.style[key]) * WIDTH) / 100,
    );
    return x >= left && x < left + width && y >= top && y < top + height;
  });
}
async function until(predicate, message, limit = 240) {
  for (let i = 0; i < limit; i++) {
    if (predicate()) return;
    await step();
  }
  const layout = [...(liveState?.coords ?? [])].map(
    ([card, coord]) =>
      `${liveState.project.get(card)?.attrs.id}@${coord.join(",")}`,
  );
  assert.fail(
    `${message}；当前画面 ${locs().join(", ")}，卡片 ${layout.join(" | ")}，热点 ${ids.hotspots.children.length}`,
  );
}
async function tap(position, x, y, location) {
  await until(() => hotspot(position, x, y), "预期热点未开放");
  hotspot(position, x, y).dispatchEvent(new Event("click"));
  await until(
    () => locs().some((l) => l.startsWith(location)),
    "未进入 " + location,
  );
}
async function drag(x, y, toX, toY, { cancel = false } = {}) {
  emit("pointermove", x, y);
  emit("pointerdown", x, y, 1);
  emit("pointermove", toX, toY, 1);
  await step();
  emit(cancel ? "pointercancel" : "pointerup", toX, toY);
  await step(4);
}

const splash = ids.startup;
const startupLog = [];
for (let i = 0; i < 64 && !splash.hidden; i++) {
  await step();
  const label = splash.children[0]?.alt;
  if (label && label !== startupLog.at(-1)) startupLog.push(label);
}
assert.deepEqual(startupLog, [
  "Annapurna Interactive",
  "Buried Signal",
  "Gorogoa",
]);
assert.equal(splash.hidden, true, "启动动画要让出棋盘");
assert.equal(ids["game-shell"].inert, false);
assert.equal(ids.pause.disabled, false);
assert.ok(time >= 10 && time <= 11, "三张启动图与过渡应共约十秒");

const { StartupScreen, STARTUP_MUSIC } = await import(
  new URL("src/engine/startup.js", root).href
);
const audioLog = [];
const startupTrack = {
  gain: {
    gain: {
      setValueAtTime() {},
      linearRampToValueAtTime(value, at) {
        audioLog.push(["fade", value, at]);
      },
    },
  },
  stop() {
    audioLog.push(["stop"]);
  },
};
const originalTime = time;
const startupProbe = new StartupScreen(
  new Element(),
  {
    context: { currentTime: 20 },
    async resume() {
      audioLog.push(["resume"]);
    },
    async load(key) {
      assert.equal(key, STARTUP_MUSIC);
      return { buffer: { duration: 50 } };
    },
    async play(key, options) {
      audioLog.push(["play", key, options.channel, options.offset]);
      return startupTrack;
    },
  },
  siteUrl,
);
await Promise.resolve();
await Promise.resolve();
time = originalTime + 2;
await startupProbe.enableMusic();
assert.deepEqual(audioLog, [["resume"], ["play", STARTUP_MUSIC, "music", 2]]);
startupProbe.update(originalTime + 15, false);
assert.equal(startupProbe.button.children[0].alt, "Gorogoa");
assert.equal(
  startupProbe.button.children[0].style.opacity,
  "1",
  "加载未就绪时保留原标题",
);
startupProbe.update(originalTime + 15, true);
startupProbe.update(originalTime + 16, true);
startupProbe.update(originalTime + 17, true);
assert.deepEqual(audioLog.slice(-2), [["fade", 0, 21], ["stop"]]);
assert.equal(startupProbe.active, false);
time = originalTime;

if (menuOnly) {
  await step();
  const savedBefore = store.get("gorogoa-web-progress-v1");
  const click = (id) => ids[id].dispatchEvent(new Event("click"));
  click("pause");
  const chapter = ids["chapter-list"].children[1];
  assert.equal(ids["chapter-list"].children.length, 6);
  assert.equal(
    ids["chapter-list"].children[5].attrs["aria-label"],
    "制作人员名单",
  );
  chapter.dispatchEvent(new Event("click"));
  assert.equal(ids["menu-action"].textContent, "载入章节？");
  click("menu-cancel");
  assert.equal(store.get("gorogoa-web-progress-v1"), savedBefore);
  chapter.dispatchEvent(new Event("click"));
  click("menu-ok");
  const original = JSON.parse(chapterBytes);
  const expected = liveState.project
    .container(original, "cards", "CardSaveData")
    .filter((entry) => entry.attrs.isInPlay === "true")
    .map((entry) => entry.attrs.locationGUID);
  await until(() => !ids["menu-ok"].disabled, "确认后没有载入第二章");
  await step(2);
  assert.equal(ids["game-menu"].hidden, true);
  assert.equal(ids.game.dataset.phase, "CHAPTERS");
  for (const location of expected) assert.ok(locs().includes(location));
  assert.equal(store.get("gorogoa-web-unlocked-chapter"), "5");
  console.log(
    "章节菜单回归通过：取消保留进度，确认读取原版第二章检查点，已解锁章节保留。",
  );
} else if (endOnly) {
  await step();
  assert.equal(ids.game.dataset.phase, "EPILOGUE");
  assert.match(locs()[0], /^head-0b759dd8/);
  await until(() => locs()[0]?.startsWith("eye-"), "尾声未自动进入眼睛");
  await until(() => ids.game.dataset.phase === "ENDING", "尾声未启动结局转场");
  assert.match(locs()[0], /^eye-/, "结局画面应与向瞳孔的镜头同时开始");
  await until(
    () => locs()[0]?.startsWith("pupil-14aed567"),
    "尾声未自动进入瞳孔",
  );
  await step(10);
  assert.equal(endingUploads, 4, "四张原版结局贴图必须全部加载");
  assert.ok(endingDraws > 1, "结局画面必须随时间更新");
  assert.equal(ids.ending.hidden, false);
  await until(() => !ids.credits.hidden, "尾声没有显示原版片尾名单");
  const heading = () => ids["credits-page"].children[0]?.children.join("");
  assert.equal(heading(), "A game by Jason Roberts");
  assert.equal(ids["credits-prev"].hidden, true);
  await until(() => heading() === "Special Thanks", "片尾名单没有按时自动翻页");
  assert.equal(ids["credits-prev"].hidden, false);
  ids["credits-prev"].dispatchEvent(new Event("click"));
  assert.equal(heading(), "A game by Jason Roberts");
  for (let i = 0; i < 7; i++)
    ids["credits-next"].dispatchEvent(new Event("click"));
  assert.ok(
    ids["credits-page"].children[0].children.some(
      (node) => node.textContent === "Indie Fund",
    ),
  );
  ids["credits-next"].dispatchEvent(new Event("click"));
  assert.equal(ids.credits.hidden, true);
  console.log(
    "尾声检查点回归通过：头像、眼睛和瞳孔自动转场，结局使用四张原版贴图，片尾名单自动和手动翻页。",
  );
} else {
  await step();
  assert.match(locs()[0], /^city1a000-/);
  assert.equal(ids.game.dataset.phase, "PROLOGUE");
  const click = (id) => ids[id].dispatchEvent(new Event("click"));
  click("pause");
  assert.equal(ids["game-menu"].hidden, false);
  assert.equal(ids.board.inert, true);
  assert.equal(ids.hotspots.children.length, 0);
  ids["chapter-list"].children[0].dispatchEvent(new Event("click"));
  assert.equal(ids["menu-confirm"].hidden, false);
  click("menu-cancel");
  assert.equal(ids["menu-controls"].hidden, false);
  assert.equal(ids["chapter-list"].children.length, 2);
  assert.equal(
    ids["chapter-list"].children[1].attrs["aria-label"],
    "制作人员名单",
  );
  click("pause");
  assert.equal(ids["game-menu"].hidden, true);
  assert.equal(ids.board.inert, false);
  await drag(358, 358, 510, 358); // Drag is disabled in the prologue.
  assert.equal(ids.game.dataset.phase, "PROLOGUE");
  assert.equal(locs().length, 1);
  emit("pointermove", 358, 358);
  await tap(center, 0.1, 0.89, "window-fec0");
  await tap(center, 0.3, 0.3, "balloon-2491");
  await tap(center, 0.52, 0.76, "balloon_bowl-");
  await tap(center, 0.5, 0.27, "at_balloon_final-");
  await tap(center, 0.5, 0.89, "window-fec0");
  await until(() => ids.game.dataset.phase === "CHAPTERS", "未进入四格棋盘");
  await step(10);
  assert.equal(locs().length, 1);
  await drag(183, 183, 533, 183, { cancel: true });
  assert.equal(locs().length, 1, "取消手势应恢复未拆开的卡");
  await drag(183, 183, 533, 183);
  await until(
    () => locs().some((l) => l.startsWith("window_hole-")),
    "拖动未拆出原版窗框卡",
  );
  await tap(upperRight, 0.89, 0.89, "left-4a4e");
  await tap(upperRight, 0.89, 0.1, "right-f47a");
  await until(
    () => locs().some((l) => l.startsWith("city1a-")),
    "拆卡后原版城市自动转场卡住",
  );
  assert.ok(pixelCalls.images > 100);
  const readSaved = () =>
    JSON.parse(store.get("gorogoa-web-progress-v1") || "null");
  await until(
    () =>
      readSaved()?.coords.some(([, point]) => point[0] === 1 && point[1] === 0),
    "拆卡后的稳定进度没有保存",
  );
  const saved = readSaved();
  assert.equal(saved.storyPhase, "CHAPTERS");
  assert.ok(saved.coords.some(([, point]) => point[0] === 1 && point[1] === 0));
  console.log("序章与拆卡回归通过：原始城市、窗前、书、碗、四格、拆卡和保存。");
  await tap(upperLeft, 0.5, 0.5, "roof00-");
  await drag(183, 183, 533, 183);
  await until(
    () =>
      locs().some((l) => l.startsWith("box-d1ce")) &&
      !locs().some((l) => l.startsWith("right-f47a")),
    "屋顶未拆出第三张卡或捕获房间",
  );
  await until(
    () =>
      readSaved()?.captors.some(
        ([child, owner]) =>
          child.startsWith("card001-") && owner.startsWith("card002-"),
      ),
    "房间 UNDER 叠合没有保存",
  );
  await until(
    () =>
      hotspot(upperRight, 0.23, 0.52) ||
      readSaved()?.states.some(
        ([, value]) =>
          value === "release card001-acf88aa5-a0c2-480b-b806-626a10cb988f",
      ),
    "孩子出亭后没有进入可拆卡状态",
  );
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((l) => l.startsWith("right-f47a")),
    "没有从屋顶下释放房间",
  );
  await tap(upperRight, 0.1, 0.89, "left-c5c2");
  await tap(upperRight, 0.81, 0.24, "close-ef84");
  await tap([358, 358], 0.23, 0.52, "bowl_wide-");
  await tap([358, 358], 0.62, 0.5, "bowl_close-");
  await tap(upperLeft, 0.1, 0.89, "far2-eef3");
  await tap(upperLeft, 0.65, 0.3, "branch_left-");
  await until(
    () => locs().some((l) => l.startsWith("bowl_wide-")),
    "树枝和碗贴齐后，果实动画未完成并退回碗全景",
  );
  await until(
    () =>
      readSaved()?.states.some(
        ([, value]) => value === "final-78c478e3-1852-4aef-8eb2-6828e6b2a628",
      ),
    "第一颗果实没有进入已拾取状态",
  );
  assert.deepEqual(bowlPartWarnings, []);
  assert.equal(bowlPartDraws.size, 2, "拾碗时两组链接图形的关键帧都必须画出");
  console.log(
    "第一章果实回归通过：屋顶叠合和拆分出第三张，树画、树枝和碗按原版方位对齐，果实落下后被拾取。",
  );
  await tap([358, 358], 0.1, 0.89, "roof_wide-");
  await tap(upperLeft, 0.1, 0.89, "yard_final-");
  await tap(upperLeft, 0.3, 0.3, "close-fe0ab");
  await until(() => hotspot([358, 358], 0.345, 0.3), "屋顶动画没有结束");
  await drag(533, 533, 183, 183);
  await until(
    () =>
      readSaved()?.captors.some(
        ([child, owner]) =>
          child.startsWith("card003-") && owner.startsWith("card002-"),
      ),
    "屋顶未捕获楼梯",
  );
  await until(
    () =>
      readSaved()?.states.some(
        ([, value]) =>
          value === "release card003-5abc0e58-0780-4c5e-9952-50daba69288b",
      ),
    "男孩没有进入亭子",
  );
  await drag(183, 183, 533, 533);
  await until(
    () => locs().some((l) => l.startsWith("close-fe0ab")),
    "屋顶下楼梯未重新出现",
  );
  await tap([358, 358], 0.345, 0.3, "door.wide-");
  console.log(
    "第一章到下一段回归通过：果实拾取后的原版转场、叠合楼梯、进入城门。",
  );
  await step(6);
  await drag(533, 533, 183, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("card003 kid-e247"),
      ),
    "城门叠上楼梯后，男孩没有走到门口",
  );
  await drag(183, 183, 533, 533);
  await until(
    () => locs().some((l) => l.startsWith("close-fe0ab")),
    "城门下的楼梯未释放",
  );
  await tap([358, 358], 0.65, 0.45, "fill-e046");
  await tap([358, 358], 0.1, 0.1, "arch-81ea");
  await tap([358, 358], 0.81, 0.45, "sign-4200");
  await drag(533, 533, 183, 533);
  await until(
    () => locs().some((l) => l.startsWith("arch only-54eb")),
    "告示牌没有拆出第四张卡",
  );
  console.log(
    "第二章开头回归通过：城门和楼梯叠合，进入拱门，放大告示牌并拆出第四张卡。",
  );
  const lowerLeft = [8, 358],
    lowerRight = [358, 358];
  await tap(lowerLeft, 0.107, 0.893, "arch-81ea");
  await drag(533, 533, 183, 533);
  await until(
    () => locs().some((l) => l.startsWith("arch-ff37")),
    "拱门叠合后，男孩没有穿过门",
  );
  await until(() => hotspot(lowerLeft, 0.495, 0.525), "男孩还未走进花园拱门");
  await drag(183, 183, 533, 533);
  await drag(183, 533, 183, 183);
  await tap(upperLeft, 0.495, 0.525, "all-afe861");
  await tap(upperLeft, 0.725, 0.6, "statues-9a97");
  await tap(upperLeft, 0.575, 0.475, "statue_hand-7b8e");
  await drag(183, 183, 183, 533);
  await until(
    () => locs().some((l) => l.startsWith("eye-b90e")),
    "拉开雕像近景后没有释放城市卡",
  );
  console.log("第二章雕像回归通过：穿过拱门、进入雕像近景，并拆出城市卡。");
  await tap(upperLeft, 0.5, 0.893, "shrine-331a");
  await tap(upperLeft, 0.5, 0.893, "wide-5c82");
  await tap(upperLeft, 0.405, 0.225, "room-2559");
  await tap(upperLeft, 0.7, 0.3, "patch-bdc7");
  await tap(upperLeft, 0.5, 0.45, "init-fdcd");
  await tap(upperLeft, 0.5, 0.49, "final-862b");
  await until(
    () => locs().some((l) => l.startsWith("face-0e23")),
    "穿过花朵后没有进入眼睛画面",
  );
  await step(4);
  await drag(183, 183, 533, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("final right-c379"),
      ),
    "移动眼睛后没有看向右侧",
  );
  await drag(183, 533, 533, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("fruit in bowl-255bb75c"),
      ),
    "雕像和眼睛叠合后第二颗果实没有落入碗中",
  );
  await tap(upperRight, 0.107, 0.893, "statues-9a97");
  await until(
    () =>
      readSaved()?.states.some(
        ([, value]) => value === "final-3a273089-9070-42de-a6dc-3a9d4e676315",
      ),
    "第二章完成标志没有触发",
  );
  await tap(upperRight, 0.893, 0.107, "middle-bb97");
  console.log(
    "第二章果实回归通过：由城市穿过花朵，移动眼睛并叠合雕像，第二颗果实落入碗中，男孩进入草坪。",
  );
  await tap(lowerRight, 0.5, 0.107, "sky-d4fd");
  await tap(upperLeft, 0.5, 0.893, "right-b229");
  await tap(upperLeft, 0.893, 0.5, "far_right-8eed");
  await tap(upperLeft, 0.51, 0.67, "chair-82b78");
  await drag(183, 183, 533, 533);
  await until(
    () =>
      readSaved()?.states.some(([, value]) => value.startsWith("lit-a1b3800c")),
    "把暗灯叠在星星上没有点亮灯",
  );
  await tap(lowerRight, 0.107, 0.893, "far_right-8eed");
  await tap(lowerRight, 0.76, 0.225, "star_chart-ad7f");
  await tap(lowerRight, 0.48, 0.51, "through mirror-c4a8");
  await tap(lowerRight, 0.475, 0.52, "all-b0f4");
  await tap(upperRight, 0.5, 0.893, "nook-117c");
  console.log(
    "第三章开头回归通过：楼梯入夜，星星与暗灯叠合点灯，穿过镜子进入房间，并进入草坪下的地窖。",
  );
  await tap(lowerRight, 0.305, 0.67, "shelf_l2-d1e7");
  await tap(upperRight, 0.25, 0.25, "shelf_r-683d");
  await drag(533, 533, 183, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) => value.startsWith("left3-fe853")),
    "同一排拼接两段书架后，行李箱没有倾斜",
  );
  await tap(upperLeft, 0.19, 0.69, "box_down-36bc");
  await drag(183, 183, 183, 533);
  await until(() => locs().length === 3, "移动左侧箱盖没有拆出第三张卡");
  await tap(upperRight, 0.48, 0.39, "box_top-08a3");
  await drag(533, 183, 533, 533);
  await until(() => locs().length === 4, "移动右侧箱盖没有拆出第四张卡");
  console.log(
    "第三章行李箱回归通过：拼接两侧书架，分别放大两件行李，再拆出两张卡。",
  );
  await tap(upperLeft, 0.893, 0.893, "all-d3cb");
  await tap(upperLeft, 0.23, 0.8, "obj3-c36f");
  await tap(upperRight, 0.5, 0.893, "all-bed5");
  await tap(upperRight, 0.74, 0.41, "obj2-8a8e");
  await drag(183, 533, 183, 183);
  await drag(533, 533, 533, 183);
  await tap(upperLeft, 0.5, 0.893, "shelf_l2-d1e7");
  await tap(upperRight, 0.5, 0.893, "shelf_r-683d");
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("right2-877298f3"),
      ),
    "选择两件物品后没有将箱子向右倾斜",
  );
  console.log(
    "第三章书架机关回归通过：改变两件物品的放大画面，使行李箱向右倾斜。",
  );
  await tap(upperLeft, 0.107, 0.893, "all-b0f4");
  await tap(upperLeft, 0.5, 0.33, "star-5f969");
  await drag(533, 183, 183, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("final-3401c0ac"),
      ),
    "叠合星星和地窖后，地窖的灯没有亮",
  );
  await tap(upperLeft, 0.24, 0.3, "moth-bb6f");
  await tap(upperLeft, 0.2, 0.61, "spot-c22b");
  await drag(183, 183, 533, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("medallion-bd78922b")),
    "移动飞蛾特写后未拆出塔楼卡",
  );
  console.log("第三章地窖回归通过：星星点亮地窖，放大飞蛾并拆出塔楼卡。");
  await tap(upperLeft, 0.5, 0.893, "path-36ae");
  await tap(upperRight, 0.5, 0.893, "moth-bb6f");
  await tap(upperRight, 0.5, 0.893, "shelf_r-683d");
  await tap(upperRight, 0.5, 0.893, "nook-117c");
  await tap(upperRight, 0.74, 0.25, "lawn_evening-bf33");
  await tap(upperLeft, 0.107, 0.893, "path_left-bab4");
  await tap(upperLeft, 0.5, 0.5, "rock_fall-3390");
  await drag(183, 183, 533, 533);
  await tap(upperRight, 0.5, 0.893, "nook-117c");
  await tap(upperRight, 0.25, 0.25, "jar_wide-5a71");
  await tap(upperRight, 0.5, 0.25, "rock_test-a4e1");
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("fall1 exit-5de60161"),
      ),
    "上下对齐时，石头没有从地窖进入塔楼",
  );
  console.log("第三章落石回归通过：地窖在上、塔楼在下，石头越过两张卡的边界。");
  await tap(upperRight, 0.5, 0.893, "left-8e0f");
  await drag(533, 183, 183, 533);
  await drag(533, 533, 183, 183);
  await tap(lowerLeft, 0.3, 0.65, "rock_fall2-8a2b");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("crossed-eec7409f"),
      ),
    "塔楼的落石没有从下缘回到地窖",
  );
  await tap(upperLeft, 0.5, 0.5, "wide-e1d5");
  await tap(upperLeft, 0.3, 0.5, "prison-081c");
  await drag(183, 183, 533, 533);
  await drag(183, 533, 533, 183);
  await until(
    () =>
      readSaved()?.states.some(([, value]) =>
        value.startsWith("fall 2 final-49b66988"),
      ),
    "落石没有击碎塔楼里的玻璃罩",
  );
  console.log("第三章玻璃罩回归通过：重排塔楼和地窖后，落石击碎玻璃罩。");
  await tap(upperRight, 0.5, 0.893, "left-8e0f");
  await tap(upperRight, 0.893, 0.893, "nook-117c");
  await tap(upperRight, 0.75, 0.25, "thought-5c86");
  await tap(upperRight, 0.65, 0.35, "wide-c788");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("start_ne-"),
      ),
    "星图没有记录右上角的初始位置",
  );
  await drag(533, 183, 183, 533);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("true-2a00ae4c"),
      ),
    "把星图移到对角后没有露出星星",
  );
  await drag(533, 533, 183, 533);
  await tap(lowerLeft, 0.5, 0.57, "moth-0bbb");
  await tap(lowerLeft, 0.4, 0.6, "spot-9150");
  await drag(183, 533, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("medallion-b97405b6")),
    "移动塔楼飞蛾的特写后没有拆出图书馆卡",
  );
  console.log(
    "第三章星图回归通过：移动星图显出星星，叠合点亮塔楼，引来飞蛾并拆出图书馆卡。",
  );
  await tap(upperLeft, 0.5, 0.893, "moth-0bbb");
  await tap(upperLeft, 0.893, 0.893, "prison-081c");
  await tap(upperLeft, 0.5, 0.893, "wide-e1d5");
  await tap(upperLeft, 0.5, 0.893, "path_left-bab4");
  await tap(upperLeft, 0.893, 0.893, "path-36ae");
  await tap(lowerLeft, 0.5, 0.893, "path_right-955a");
  await drag(183, 183, 533, 533);
  await tap(lowerLeft, 0.107, 0.893, "path-f123");
  await tap(lowerLeft, 0.107, 0.893, "wide_left-1134");
  console.log("第三章图书馆回归通过：拼接两段小路，引导男孩走向图书馆。");
  await drag(533, 533, 533, 183);
  await tap(lowerLeft, 0.75, 0.3, "desk-1ea5");
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) =>
          value.startsWith("release-") &&
          liveState.project.get(value)?.attrs.id === "release init",
      ),
    "书桌的思绪卡没有准备好",
  );
  await step(12);
  await drag(183, 533, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("init-0ba38383")),
    "没有拆出山丘卡",
  );
  await tap(lowerLeft, 0.25, 0.35, "tower-5c30");
  await tap(lowerLeft, 0.5, 0.35, "clock-789d");
  await drag(183, 533, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("watch-4e3a940a")),
    "时钟没有拆出怀表卡",
  );
  await tap(lowerLeft, 0.5, 0.893, "wide-3b43");
  await tap(lowerLeft, 0.78, 0.27, "compass-d71c");
  await drag(183, 533, 183, 183);
  await tap(lowerRight, 0.5, 0.893, "wide-3a9a");
  await tap(lowerRight, 0.893, 0.893, "right_wide-e6f5");
  await tap(lowerRight, 0.75, 0.55, "fireplace-581a");
  await tap(lowerRight, 0.5, 0.6, "fireplace_close-37a0");
  await tap(lowerRight, 0.5, 0.5, "fire-62ca");
  await tap(upperRight, 0.107, 0.893, "path_left-bab4");
  await tap(upperRight, 0.5, 0.5, "rock_fall-3390");
  await tap(upperRight, 0.5, 0.5, "wide-e1d5");
  await tap(upperRight, 0.75, 0.25, "still_wide-8c02");
  await tap(upperRight, 0.67, 0.385, "still_close-63d4");
  await until(
    () =>
      [...liveState.states.values()].some((value) => value.startsWith("h7-")),
    "蒸馏器没有在壁炉上方加热到七点",
  );
  console.log(
    "第三章计时回归通过：图书馆拆出山丘和指南针，壁炉加热蒸馏器，时钟进入七点状态。",
  );
  await tap(upperRight, 0.5, 0.29, "gauge-70d4");
  await tap(lowerRight, 0.5, 0.893, "fireplace_close-37a0");
  await tap(lowerRight, 0.5, 0.893, "fireplace-581a");
  await tap(lowerRight, 0.107, 0.893, "right_wide-e6f5");
  await tap(lowerRight, 0.25, 0.4, "globe-2dd9");
  await tap(lowerRight, 0.7, 0.2, "pole-09f3");
  await step(90, 1 / 60);
  await until(
    () =>
      liveState.states
        .get("compass_dir-fa8156b9-0736-417c-9649-6e4440b94fe1")
        ?.startsWith("southeast-"),
    "指南针没有指向东南方",
  );
  await drag(533, 183, 183, 183);
  await drag(183, 533, 183, 183);
  await until(
    () =>
      liveState.states
        .get("time-dbb0d4dd-6fe6-4af4-91d5-544a96a0c98e")
        ?.startsWith("valid-"),
    "三层时钟未锁定",
  );
  await tap(upperLeft, 0.5, 0.893, "tower-5c30");
  await tap(upperLeft, 0.5, 0.893, "ext-8cc5");
  await tap(upperLeft, 0.52, 0.35, "star-710d");
  await tap(lowerRight, 0.5, 0.893, "globe-2dd9");
  await tap(lowerRight, 0.2, 0.35, "moon-6bda");
  await drag(533, 533, 183, 183);
  await tap(upperLeft, 0.75, 0.5, "moth-4831");
  await tap(upperLeft, 0.59, 0.62, "spot-fe0d");
  await drag(183, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("medallion-1f5d4141")),
    "图书馆飞蛾没有拆出画中道路",
  );
  console.log(
    "第三章时钟和飞蛾回归通过：叠合东南指南针、蒸馏器和时钟，暮色星星点亮月亮，引来飞蛾。",
  );
  await tap(lowerRight, 0.5, 0.893, "moth-4831");
  await tap(lowerRight, 0.5, 0.893, "wide-3a9a");
  await tap(lowerRight, 0.107, 0.893, "wide_left-1134");
  await tap(lowerRight, 0.25, 0.55, "path-f123");
  await tap(lowerRight, 0.893, 0.893, "path_right-955a");
  await tap(upperLeft, 0.5, 0.893, "path-30b3");
  await drag(533, 533, 533, 183);
  await tap(upperLeft, 0.107, 0.893, "tree-0cb8");
  await until(
    () =>
      [...liveState.states.values()].includes(
        "wait_in_archway-b4e1ea35-8b78-4399-8c3f-c4c3e47e6b7d",
      ),
    "第三章完成标记没有触发",
  );
  console.log(
    "第三章通关回归通过：拼接图书馆与画中道路，男孩走到门廊，触发第四章里程碑。",
  );
  await tap(upperLeft, 0.893, 0.893, "close-f64a");
  await tap(upperLeft, 0.5, 0.893, "pic1-6da9");
  await until(
    () => locs().some((loc) => loc.startsWith("wide-5e184b2f")),
    "从门廊返回后没有显出画墙",
  );
  await tap(upperRight, 0.107, 0.893, "path-f123");
  await tap(upperRight, 0.107, 0.893, "wide_left-1134");
  await tap(upperRight, 0.75, 0.3, "desk-1ea5");
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) => liveState.project.get(value)?.attrs.id === "release final",
      ),
    "书桌还未出现最后一张思绪卡",
  );
  await step(12);
  await drag(533, 183, 183, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("win-99d023bc")),
    "拖动书桌没有拆出公寓窗户",
  );
  console.log("第四章开头回归通过：进入画墙，回图书馆书桌并拆出公寓窗户。");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("release-3c5a57ab"),
      ),
    "公寓窗前的地图未出现",
  );
  await step(8);
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("wide-ea87a99a")),
    "公寓窗户没有拆出地图",
  );
  await drag(533, 183, 533, 533);
  await tap(lowerRight, 0.5, 0.5, "compass-ecf8");
  await tap(lowerRight, 0.5, 0.5, "mid-1680");
  await tap(lowerRight, 0.5, 0.5, "close-6798");
  await tap(upperLeft, 0.25, 0.25, "pic1-6da9");
  await tap(upperLeft, 0.8, 0.45, "cross1-89be");
  await drag(533, 533, 183, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("after_cross1-"),
      ),
    "拼接第一幅画框和楼梯后男孩没有通过",
  );
  console.log(
    "第四章第一段画框回归通过：拆出地图、进入画中的楼梯，并和第一幅画拼接。",
  );
  await drag(183, 183, 533, 533);
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) => liveState.project.get(value)?.attrs.id === "in_pic2",
      ),
    "分开第一幅画后男孩没有进入第二幅画",
  );
  await tap(upperLeft, 0.893, 0.893, "pic2-eccd");
  await tap(upperLeft, 0.3, 0.4, "close-7f20");
  await tap(lowerRight, 0.5, 0.893, "w_south-e234");
  await tap(lowerRight, 0.5, 0.893, "wide-d555");
  await tap(lowerRight, 0.69, 0.42, "wheel-3f33");
  await tap(lowerLeft, 0.8, 0.46, "wide-67a0");
  await tap(lowerLeft, 0.65, 0.47, "anthologies_close-66bb");
  await tap(lowerLeft, 0.45, 0.45, "anthology1-b6e4");
  await tap(lowerLeft, 0.5, 0.3, "sun-39ed");
  await drag(183, 533, 533, 533);
  await drag(183, 533, 533, 183);
  await tap(lowerLeft, 0.8, 0.68, "table-1e70");
  await tap(lowerLeft, 0.53, 0.43, "bell-bc09");
  await tap(lowerLeft, 0.5, 0.5, "star-3d75");
  await tap(lowerLeft, 0.5, 0.107, "wall-3552");
  await until(
    () =>
      liveState.states
        .get("_wheel3-c69efac5-c401-4268-bed5-96b7f7ed9eeb")
        ?.startsWith("r270-"),
    "太阳与沙漠接好后，博物馆转轮未转到西侧",
  );
  await tap(upperRight, 0.3, 0.4, "w_west-5945");
  await tap(upperRight, 0.6, 0.5, "close_r90-d980");
  console.log(
    "第四章转轮回归通过：书中太阳、沙漠和博物馆连成机关，转出通往下一幅画的入口。",
  );
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("at_door-"),
      ),
    "男孩没有走到第二段楼梯门口",
  );
  await tap(upperLeft, 0.5, 0.893, "pic2-eccd");
  await tap(upperLeft, 0.5, 0.893, "wide-5e184b");
  await tap(upperLeft, 0.8, 0.7, "pic4-a65a");
  await tap(upperLeft, 0.7, 0.55, "close-d19d");
  await step(8);
  await drag(533, 183, 183, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("in_doorway-"),
      ),
    "第二段楼梯叠到画框后，男孩没有进门",
  );
  await step(8);
  await drag(183, 183, 533, 183);
  await tap(upperRight, 0.5, 0.893, "w_sotuhwest-7794");
  await tap(upperRight, 0.5, 0.893, "window-ef10");
  await tap(upperLeft, 0.5, 0.893, "pic4-a65a");
  await tap(upperLeft, 0.3, 0.5, "cross2-906b");
  console.log(
    "第四章第二段画框回归通过：男孩走进下一幅画，进入废墟圆窗与第二处画框交界。",
  );
  await tap(lowerLeft, 0.107, 0.893, "star-3d75");
  await tap(lowerLeft, 0.5, 0.893, "bell-bc09");
  await until(
    () => locs().some((loc) => loc.startsWith("table-1e70")),
    "沙漠画面没有自动退回餐桌",
  );
  await tap(lowerLeft, 0.8, 0.48, "figurine-6f5c");
  await tap(lowerLeft, 0.5, 0.5, "top-d92e");
  await tap(lowerLeft, 0.5, 0.893, "bottom-0eadd");
  await tap(lowerLeft, 0.5, 0.5, "wheel-dabd");
  await drag(533, 183, 183, 533);
  await until(
    () =>
      [...liveState.states].some(
        ([container, value]) =>
          liveState.project.owner(liveState.project.get(container), "Scene")
            ?.attrs.id === "ruin" && value.startsWith("r180-"),
      ),
    "森林转轮没有转正废墟圆窗",
  );
  await drag(183, 533, 533, 183);
  await tap(upperRight, 0.5, 0.8, "w_south-fb02");
  await tap(upperRight, 0.5, 0.5, "mid_r180-e18d");
  await tap(upperRight, 0.65, 0.5, "close_r180-4ddf");
  await drag(533, 183, 183, 183);
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) => liveState.project.get(value)?.attrs.id === "after_cross2",
      ),
    "旋转后的圆窗未能接上第二处交界",
  );
  console.log("第四章废墟圆窗回归通过：用森林转轮旋转圆窗，与画中楼梯叠合。");
  await step(8);
  await drag(183, 183, 533, 183);
  await tap(upperLeft, 0.107, 0.893, "pic3-0a3d");
  await tap(upperLeft, 0.45, 0.3, "close-6f0f");
  await tap(upperRight, 0.5, 0.893, "w1_south-2e19");
  await tap(upperRight, 0.5, 0.893, "wheel1-265c");
  await tap(lowerLeft, 0.5, 0.893, "bottom-0eadd");
  await tap(lowerLeft, 0.5, 0.107, "top-d92e");
  await tap(lowerLeft, 0.107, 0.5, "figurine-6f5c");
  await until(
    () => locs().some((loc) => loc.startsWith("table-1e70")),
    "森林画面没有自动退回餐桌",
  );
  await tap(lowerLeft, 0.23, 0.62, "ladle-476f");
  await tap(lowerLeft, 0.5, 0.5, "left-cad5");
  await tap(lowerLeft, 0.893, 0.107, "right-2bc0");
  await tap(lowerRight, 0.5, 0.893, "anthologies_close-66bb");
  await tap(lowerRight, 0.5, 0.893, "wide-67a0");
  await tap(lowerRight, 0.24, 0.45, "dictionary_wide-a2b7");
  await tap(lowerRight, 0.4, 0.3, "anthology3-6b98");
  await tap(lowerRight, 0.5, 0.4, "moon-8175");
  await tap(upperRight, 0.5, 0.893, "wide-9f2a");
  await drag(533, 533, 533, 183);
  await until(
    () => hotspot(lowerLeft, 0.107, 0.107),
    "山间卡未暂停，暂时不能叠合月亮",
  );
  await drag(183, 533, 533, 183);
  await until(
    () =>
      liveState.states
        .get("_wheel1-f5dc2586-a16e-444d-a934-2f57a407ee82")
        ?.startsWith("r90-"),
    "月亮没有带动厨房转轮转向北侧",
  );
  await drag(533, 183, 183, 533);
  await drag(533, 183, 533, 533);
  await tap(upperRight, 0.5, 0.34, "wheel1-265c");
  await tap(upperRight, 0.5, 0.26, "w1_north-8763");
  await tap(upperRight, 0.5, 0.5, "mid-988b");
  await tap(upperRight, 0.5, 0.5, "close-73bf");
  await drag(533, 183, 183, 183);
  await until(
    () =>
      liveState.states
        .get("char-a0d6d126-5af8-48e4-b19d-128a2fd08c6d")
        ?.startsWith("at_fruit-"),
    "画中的男孩没有从第三幅画走向果实",
  );
  console.log(
    "第四章厨房转轮回归通过：月亮带动山间道路，北面的画框接上了第三幅画。",
  );
  await tap(upperRight, 0.5, 0.893, "pic3-0a3d");
  await tap(upperRight, 0.5, 0.893, "wide-5e184b");
  await tap(upperRight, 0.15, 0.72, "pic5-be75");
  await tap(upperRight, 0.5, 0.5, "mid-a614");
  await tap(upperRight, 0.5, 0.5, "close-f7d1");
  await drag(533, 183, 183, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("wait-558b67d8"),
      ),
    "男孩没有摘到第四颗果实",
  );
  await tap(upperRight, 0.5, 0.893, "broken_north-f358");
  await tap(upperRight, 0.5, 0.893, "broken-722b");
  await tap(upperRight, 0.5, 0.893, "wide_right-cf27");
  await tap(upperRight, 0.107, 0.893, "platform left-dcdd");
  await drag(533, 183, 183, 183);
  await until(
    () =>
      [...liveState.states.values()].includes(
        "final-761a9fa0-a611-42c7-b928-cf6ada703961",
      ),
    "第四章完成标记没有触发",
  );
  console.log(
    "第四章通关回归通过：拾取第四颗果实，并把画框叠到站台，触发第五章里程碑。",
  );
  await tap(upperLeft, 0.893, 0.893, "wide_right-cf27");
  await tap(upperLeft, 0.7, 0.5, "sign-52c9");
  await tap(upperLeft, 0.25, 0.72, "dest-0fac");
  await drag(183, 183, 533, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("sign_init-d9e2")),
    "车站站牌没有拆出下一张卡",
  );
  await tap(upperRight, 0.5, 0.893, "sign-52c9");
  await tap(upperRight, 0.5, 0.893, "wide_right-cf27");
  await tap(upperRight, 0.35, 0.45, "fare_wide-e242");
  await tap(upperRight, 0.68, 0.5, "fare-bcc8");
  await tap(lowerLeft, 0.107, 0.107, "left-cad5");
  await tap(lowerLeft, 0.5, 0.893, "ladle-476f");
  await until(
    () => locs().some((loc) => loc.startsWith("table-1e70")),
    "山路画面没有自动退回餐桌",
  );
  await tap(lowerLeft, 0.107, 0.893, "win-99d0");
  await tap(lowerLeft, 0.893, 0.5, "right-88bd");
  await tap(lowerLeft, 0.75, 0.35, "cal-c918");
  await tap(lowerLeft, 0.5, 0.27, "top-d197");
  await tap(lowerLeft, 0.42, 0.7, "ring-01fb");
  await tap(lowerRight, 0.5, 0.893, "dictionary_wide-a2b7");
  await tap(lowerRight, 0.5, 0.893, "wide-67a0");
  await tap(lowerRight, 0.5, 0.893, "pics-1ad3");
  await tap(lowerRight, 0.5, 0.893, "room_r-d461");
  await tap(lowerRight, 0.5, 0.893, "win-3752");
  await drag(183, 533, 533, 533);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("final-d4a8f9a8"),
      ),
    "叠合公寓窗户后没有取出戒指",
  );
  await step(6);
  await drag(533, 533, 533, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("wide_right-cf27")),
    "戒指没有开启检票口并返回站台",
  );
  console.log(
    "第五章检票回归通过：从站牌拆出下一站，拼接公寓窗户和戒指，打开检票口。",
  );
  await tap(upperRight, 0.05, 0.45, "map_wide-4196");
  await tap(upperRight, 0.5, 0.35, "wide-a3b6");
  await tap(upperLeft, 0.5, 0.893, "wide_l-5b8e");
  await tap(upperLeft, 0.107, 0.107, "shrine-bc29");
  await tap(upperLeft, 0.107, 0.107, "window-8710");
  await tap(upperLeft, 0.54, 0.5, "trellis_l-d4d8");
  await tap(upperRight, 0.33, 0.29, "northwest-3df0");
  await tap(upperRight, 0.72, 0.5, "pw1-2010");
  await until(() => hotspot(upperRight, 0.5, 0.893), "列车画面还不能移动");
  await drag(533, 183, 183, 533);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("patchworkS3-"),
      ),
    "把路线图放在铁架下方后，电车没有驶到下一段",
  );
  await tap(lowerLeft, 0.5, 0.893, "wide-a3b6");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("en route-b8bc"),
      ),
    "电车没有沿路线图抵达下一站",
  );
  await tap(upperLeft, 0.5, 0.893, "window-8710");
  await tap(upperLeft, 0.893, 0.107, "wide_l-5b8e");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("final-20d0a41a"),
      ),
    "电车没有在新站台停下",
  );
  await tap(upperLeft, 0.107, 0.107, "shrine-bc29");
  await tap(upperLeft, 0.107, 0.107, "window-8710");
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("at_door-d5964ff5"),
      ),
    "男孩没有从左侧回到窗前",
  );
  await tap(upperLeft, 0.893, 0.107, "shrine-bc29");
  await tap(upperLeft, 0.75, 0.25, "thought-97b4");
  await drag(183, 183, 533, 183);
  await until(
    () => locs().some((loc) => /^panel[0-3]-/.test(loc)),
    "窗前思绪没有拆出拼布卡",
  );
  console.log(
    "第五章地图回归通过：铁架和路线图接续电车，男孩下车后从窗前拆出拼布卡。",
  );
  await drag(183, 183, 533, 533);
  await tap(lowerLeft, 0.72, 0.72, "southeast-0230");
  await tap(lowerLeft, 0.38, 0.62, "pw2_center-6372");
  await drag(183, 533, 183, 183);
  await tap(lowerRight, 0.5, 0.893, "wide-36a9");
  await tap(lowerRight, 0.68, 0.35, "panel2-642f");
  await drag(533, 183, 533, 533);
  await tap(lowerRight, 0.5, 0.893, "shrine-bc29");
  await until(
    () => hotspot(lowerRight, 0.47, 0.8),
    "窗前动画完成后仍无法移动卡片",
  );
  await drag(533, 533, 533, 183);
  await tap(upperLeft, 0.72, 0.23, "pw2_thought-4849");
  await drag(183, 183, 183, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("scissors-11b5")),
    "剪刀思绪没有拆出书本卡",
  );
  await tap(upperLeft, 0.5, 0.893, "wide-5caa");
  await tap(upperLeft, 0.24, 0.63, "hand_l-4de5");
  await drag(183, 533, 183, 183);
  await tap(upperLeft, 0.5, 0.893, "pw2_center-6372");
  await tap(upperRight, 0.47, 0.8, "tiny_door-f9ea");
  await drag(183, 183, 533, 533);
  await drag(533, 183, 183, 533);
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) =>
          value.startsWith("final-") &&
          liveState.project.owner(liveState.project.get(value), "SceneLayer")
            ?.attrs.guid === "kid-61d0f8c9-6e0e-4407-b8f5-65d17600a45a",
      ),
    "左右对接后，男孩没有走进矮门",
  );
  console.log(
    "第五章路线图回归通过：拼布指向出口，剪刀剪开左侧路线，男孩通过矮门。",
  );
  await tap(lowerRight, 0.5, 0.893, "southeast-0230");
  await tap(lowerRight, 0.78, 0.58, "pw3-9807");
  await tap(lowerLeft, 0.5, 0.893, "shrine-bc29");
  await tap(lowerLeft, 0.47, 0.4, "emblem-4acc");
  await tap(lowerLeft, 0.5, 0.5, "wide_right-c9a5");
  await tap(lowerLeft, 0.25, 0.65, "door-8c15");
  await tap(lowerLeft, 0.75, 0.75, "trellis-92f7");
  await until(() => hotspot(lowerLeft, 0.6, 0.22), "塔楼的房间思绪还未出现");
  await drag(183, 533, 183, 183);
  await tap(upperLeft, 0.6, 0.22, "thought_small-92e1");
  await drag(183, 183, 183, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("room-af6a")),
    "塔楼思绪没有拆出房间卡",
  );
  await drag(183, 183, 533, 183);
  await tap(upperRight, 0.16, 0.84, "point_u-f7b2");
  await drag(183, 533, 533, 183);
  await tap(upperRight, 0.5, 0.893, "trellis-92f7");
  await tap(upperRight, 0.107, 0.107, "trellis_top-db0f");
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) =>
          value.startsWith("wait-") &&
          liveState.project.owner(liveState.project.get(value), "SceneLayer")
            ?.attrs.guid === "char_pw3-61bfe132-125b-4a7f-b45a-1d174a39a325",
      ),
    "男孩没有从塔楼顶边进入地图",
  );
  console.log(
    "第五章塔楼回归通过：房间画面指向上方，男孩爬上铁架并从边缘走进地图。",
  );
  await tap(upperRight, 0.107, 0.893, "trellis-92f7");
  await tap(upperRight, 0.107, 0.893, "door-8c15");
  await tap(upperRight, 0.5, 0.893, "wide_right-c9a5");
  await tap(upperRight, 0.7, 0.65, "notch-e44e");
  await drag(533, 533, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("final-01e87acc"),
      ),
    "将地图移到梯子上方后，男孩没有到达塔楼",
  );
  await tap(lowerRight, 0.107, 0.893, "wide_right-c9a5");
  await tap(upperRight, 0.5, 0.893, "southeast-0230");
  await tap(upperRight, 0.5, 0.893, "wide-a3b6");
  await tap(upperRight, 0.5, 0.893, "all-d23d");
  await tap(lowerRight, 0.5, 0.107, "wide_top-f111");
  await tap(lowerRight, 0.26, 0.45, "tower_top-2e89");
  await until(
    () =>
      liveState.states
        .get("char_in_tower-26577db0-6763-4b1c-962c-d1bce7153a0c")
        ?.startsWith("think-"),
    "男孩还没有拾起第五颗果实",
  );
  await drag(533, 533, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].includes(
        "wait for arrival-9c5a5cd3-0985-4ef4-9024-2649e54f24da",
      ),
    "第五章完成标记没有触发",
  );
  console.log(
    "第五章通关回归通过：登上塔楼取得第五颗果实，叠合地图并捧起碗，触发终局里程碑。",
  );
  await until(
    () => locs()[0]?.startsWith("bottom-380d"),
    "男孩捧起碗后没有抵达塔底",
  );
  await tap(upperRight, 0.5, 0.893, "wide_final-980d");
  await tap(upperRight, 0.5, 0.107, "final_mid-5eb6");
  await tap(upperRight, 0.5, 0.107, "finale_lev2-b2fa");
  await tap(upperRight, 0.5, 0.107, "wide_top_final-bf75");
  await tap(upperRight, 0.65, 0.3, "wide-939e");
  await tap(upperRight, 0.23, 0.38, "fruit1-9fa7");
  await until(() => hotspot(upperRight, 0.5, 0.893), "第一段回忆没有就绪");
  await drag(533, 183, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("thought-2b04")),
    "红色果实没有拆出第一段回忆",
  );
  await tap(upperRight, 0.5, 0.893, "all-af3a");
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("pic_close-2c11")),
    "第一段回忆没有拆出画框卡",
  );
  await tap(upperRight, 0.5, 0.893, "yellow_room-b60c");
  await tap(upperRight, 0.5, 0.5, "right-88ea2d53");
  await tap(upperRight, 0.107, 0.107, "left-11d0");
  await tap(upperRight, 0.23, 0.28, "window-842b");
  await tap(upperRight, 0.3, 0.3, "balloon-cae9");
  await drag(533, 533, 533, 183);
  await tap(upperRight, 0.5, 0.25, "thought-2b04");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第一段回忆重叠后没有就绪",
  );
  await drag(183, 183, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("lit-e9bc"),
      ),
    "第一段回忆没有点亮红色果实",
  );
  await tap(upperRight, 0.5, 0.893, "wide-939e");
  console.log("终局第一段回忆通过：从画框找回气球，叠合回忆并点亮第一颗果实。");
  await tap(upperRight, 0.37, 0.17, "fruit2-755f");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第二颗果实的回忆没有就绪",
  );
  await drag(533, 183, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("thought_close-9a8b")),
    "切换到第二颗果实时没有同步切换回忆",
  );
  await tap(upperRight, 0.5, 0.893, "wide-b6b0");
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("wide2-47f1")),
    "第二段回忆没有拆出地图卡",
  );
  await tap(upperRight, 0.3, 0.65, "sw0-63da");
  await tap(upperRight, 0.7, 0.55, "sw0e1-6565");
  await tap(upperRight, 0.5, 0.5, "c2-d617");
  await tap(upperRight, 0.5, 0.3, "arch-a9a5");
  await tap(upperRight, 0.5, 0.5, "all-535c");
  await drag(533, 533, 533, 183);
  await tap(upperRight, 0.5, 0.25, "thought_close-9a8b");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第二段回忆重叠后没有就绪",
  );
  await drag(183, 183, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("lit-28de"),
      ),
    "第二段回忆没有点亮第二颗果实",
  );
  await tap(upperRight, 0.5, 0.893, "wide-939e");
  console.log("终局第二段回忆通过：沿地图穿过拱门，叠合回忆并点亮第二颗果实。");
  await tap(upperRight, 0.5, 0.38, "fruit3-7252");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第三颗果实的回忆没有就绪",
  );
  await drag(533, 183, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("thought-9b0b")),
    "切换到第三颗果实时没有同步切换回忆",
  );
  await tap(upperRight, 0.5, 0.893, "all-a6cb");
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("all-9cef")),
    "第三段回忆没有拆出星星卡",
  );
  await tap(upperRight, 0.28, 0.5, "star-5133");
  await tap(lowerRight, 0.5, 0.893, "window-a4cd");
  await tap(lowerRight, 0.27, 0.5, "moth-44ca");
  await until(
    () =>
      [...liveState.states.values()].some(
        (value) =>
          value.startsWith("final-") &&
          liveState.project.owner(liveState.project.get(value), "Card")?.attrs
            .id === "card013c",
      ),
    "星星在飞蛾上方时，飞蛾没有飞向它",
  );
  await tap(lowerRight, 0.5, 0.893, "window-a4cd");
  await tap(lowerRight, 0.75, 0.5, "all-a6cb");
  await until(
    () => hotspot(lowerRight, 0.5, 0.893),
    "书桌镜头返回后仍无法移动",
  );
  await step(16);
  await drag(533, 533, 533, 183);
  await tap(upperRight, 0.7, 0.25, "thought-9b0b");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第三段回忆重叠后没有就绪",
  );
  await drag(183, 183, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("lit-0c5f"),
      ),
    "第三段回忆没有点亮第三颗果实",
  );
  await tap(upperRight, 0.5, 0.893, "wide-939e");
  console.log("终局第三段回忆通过：用星星引飞蛾，再叠合回忆并点亮第三颗果实。");
  await tap(upperRight, 0.64, 0.17, "fruit4-68e6");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第四颗果实的回忆没有就绪",
  );
  await drag(533, 183, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("thought-ec84")),
    "切换到第四颗果实时没有同步切换回忆",
  );
  await tap(upperRight, 0.5, 0.893, "all-c8cf");
  await until(() => hotspot(upperRight, 0.5, 0.25), "第四段回忆还不能拆卡");
  await drag(533, 183, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("big_wheel-9395")),
    "第四段回忆没有拆出齿轮卡",
  );
  await tap(upperRight, 0.893, 0.893, "all-3bf3");
  await tap(upperRight, 0.5, 0.72, "small_wheel-cc97");
  await drag(533, 183, 183, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("top-52f4")),
    "小齿轮没有拆出行人卡",
  );
  await tap(upperRight, 0.5, 0.893, "all-f9da");
  await step(8);
  await drag(183, 533, 533, 183);
  await tap(upperRight, 0.5, 0.893, "all-3bf3");
  await tap(upperRight, 0.27, 0.33, "big_wheel-9395");
  await until(
    () =>
      liveState.states
        .get("gears-4d8f3b55-4637-434f-9643-e53818bf4e40")
        ?.startsWith("stop270-") && hotspot(upperRight, 0.893, 0.893),
    "齿轮没有停在能够叠合的方向",
  );
  await drag(533, 533, 533, 183);
  await tap(upperRight, 0.5, 0.25, "thought-ec84");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第四段回忆重叠后没有就绪",
  );
  await drag(183, 183, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("lit-7488"),
      ),
    "第四段回忆没有点亮第四颗果实",
  );
  await tap(upperRight, 0.5, 0.893, "wide-939e");
  console.log(
    "终局第四段回忆通过：等齿轮转到所需方向，叠合回忆并点亮第四颗果实。",
  );
  await tap(upperRight, 0.77, 0.38, "fruit5-1640");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第五颗果实的回忆没有就绪",
  );
  await drag(533, 183, 183, 183);
  await until(
    () => locs().some((loc) => loc.startsWith("thought_close-3506")),
    "切换到第五颗果实时没有同步切换回忆",
  );
  await drag(533, 183, 183, 533);
  await tap(lowerLeft, 0.5, 0.893, "all-a076");
  await until(() => hotspot(lowerLeft, 0.7, 0.25), "第五段回忆还不能拆卡");
  await drag(183, 533, 533, 533);
  await until(
    () => locs().some((loc) => loc.startsWith("all-9119")),
    "第五段回忆没有拆出画纸卡",
  );
  await drag(183, 183, 533, 183);
  await drag(183, 533, 183, 183);
  await tap(upperLeft, 0.5, 0.5, "all-97f2");
  await step(8);
  await drag(183, 183, 183, 533);
  await tap(lowerLeft, 0.5, 0.5, "all-f050");
  await step(8);
  await drag(533, 183, 183, 183);
  await drag(183, 533, 533, 183);
  await drag(533, 533, 533, 183);
  await tap(upperRight, 0.7, 0.25, "thought_close-3506");
  await until(
    () => hotspot(upperRight, 0.5, 0.893),
    "第五段回忆重叠后没有就绪",
  );
  await drag(183, 183, 533, 183);
  await until(
    () =>
      [...liveState.states.values()].some((value) =>
        value.startsWith("lit-94ce"),
      ),
    "第五段回忆没有点亮第五颗果实",
  );
  await tap(upperRight, 0.5, 0.893, "wide-939e");
  console.log("终局第五段回忆通过：由画纸回到房间，拼好被子并点亮第五颗果实。");
  await until(
    () => ids.game.dataset.phase === "EPILOGUE",
    "五段回忆结束后没有进入尾声",
  );
  await until(() => locs()[0]?.startsWith("eye-"), "自然通关后未自动进入眼睛");
  await until(
    () => ids.game.dataset.phase === "ENDING",
    "自然通关后未启动结局",
  );
  await until(
    () => locs()[0]?.startsWith("pupil-14aed567"),
    "自然通关后未自动进入瞳孔",
  );
  await step(10);
  assert.equal(endingUploads, 4);
  assert.ok(endingDraws > 1);
  assert.equal(ids.ending.hidden, false);
  assert.equal(store.get("gorogoa-web-unlocked-chapter"), "6");
  console.log("完整通关回归通过：新游戏、五章、五段回忆、尾声和结局。");
}
