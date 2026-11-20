import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { pathToFileURL } from "node:url";
import App from "../src/ui/App.vue";
import { createGameUi } from "../src/ui/useGame.js";
import { createResources } from "../src/resources/json.js";
import { startGame } from "../src/game/runtime.js";
import { AudioBank } from "../src/engine/audio/audio.js";
import { SoundtrackDirector } from "../src/engine/audio/soundtrack.js";
import { InterfaceSounds } from "../src/engine/audio/interface.js";
import { createBrowser } from "./helpers/browser.js";
import { detectLanguage } from "../src/i18n/index.js";
import { StartupScreen } from "../src/game/screens/startup.js";
import { AtlasStore } from "../src/engine/render/atlas.js";
import { SceneRenderer } from "../src/engine/render/renderer.js";
import { ProjectScripts } from "../src/engine/model/scripts.js";
import { RuntimeState } from "../src/engine/model/state.js";
import * as projectModel from "../src/engine/model/project.js";
import { BOARD_SIZE } from "../src/engine/model/board.js";
import { CARD_SIZE } from "../src/engine/render/camera.js";
import { EndingScreen } from "../src/game/screens/ending.js";
import { EndingCredits } from "../src/game/screens/credits.js";
import { engine } from "animejs/engine";
import { GameMotion } from "../src/game/motion.js";

let browser, model, wrapper;
beforeEach(() => {
  browser = createBrowser(pathToFileURL(process.cwd() + "/"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  wrapper?.unmount();
  model?.dispose();
  for (const key of [
    "fullscreenEnabled",
    "fullscreenElement",
    "exitFullscreen",
  ])
    Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  document.body.replaceChildren();
});
function mountUi() {
  model = createGameUi();
  wrapper = mount(App, { props: { model }, attachTo: document.body });
  Object.assign(model.ui, { ready: true, startupActive: false, paused: true });
  model.actions.toggleMenu = vi.fn(() => {
    model.ui.paused = !model.ui.paused;
  });
  return model;
}
const element = (id) => document.getElementById(id);
async function click(id) {
  element(id).click();
  await flushPromises();
  await nextTick();
}
async function escape() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await nextTick();
}

test.each([
  [["en-GB"], "en"],
  [["zh-SG"], "zh-CN"],
  [["zh-HK"], "zh-TW"],
  [["zh-Hant"], "zh-TW"],
  [["zh-Hans-TW"], "zh-CN"],
  [["ES-mx"], "es-MX"],
  [["pt-PT"], "pt-BR"],
  [["ja-JP", "en"], "ja"],
  [["fi-FI", "fr-FR"], "fr"],
  [["en-US", "zh-CN"], "en"],
  [["fi-FI"], "en"],
  [[], "en"],
])("浏览器偏好 %j 匹配 %s", (codes, expected) => {
  expect(detectLanguage(codes)).toBe(expected);
});

test("首次按浏览器语言显示名称，手动切换同步标题、菜单与启动辅助文本", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US", "zh-CN"]);
  mountUi();
  await nextTick();
  expect(model.settings.language).toBe("en");
  expect(document.title).toBe("Gorogoa");
  expect(browser.store.has("gorogoa-web-language")).toBe(false);
  const startup = new StartupScreen(
    element("startup"),
    {},
    document.baseURI,
    () => model.t("gameName"),
  );
  await flushPromises();
  const logoUrl = startup.images.at(-1).src;
  for (const [code, name] of [
    ["en", "Gorogoa"],
    ["zh-CN", "画中世界"],
    ["zh-TW", "畫中世界"],
    ["fr", "Gorogoa"],
  ]) {
    await model.actions.chooseLanguage(code);
    startup.update(7, false);
    expect(document.title).toBe(name);
    expect(document.documentElement.lang).toBe(code);
    expect(wrapper.get("h1").text()).toBe(name);
    expect(wrapper.get("#title-panel h2").text()).toBe(name);
    expect(element("ending").getAttribute("aria-label")).toBe(
      `${name} · ${model.t("ending")}`,
    );
    expect(startup.images.at(-1).alt).toBe(name);
    expect(startup.images.at(-1).src).toBe(logoUrl);
  }
  expect(browser.store.get("gorogoa-web-language")).toBe("fr");
});

test("已保存的手动语言优先于浏览器偏好", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  browser.store.set("gorogoa-web-language", "zh-TW");
  mountUi();
  await nextTick();
  expect(model.settings.language).toBe("zh-TW");
  expect(document.title).toBe("畫中世界");
});

test("无语言偏好列表时使用 navigator.language", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-HK");
  mountUi();
  expect(model.settings.language).toBe("zh-TW");
  expect(document.title).toBe("畫中世界");
});

test("无效的已保存语言重新按浏览器偏好选择", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
  browser.store.set("gorogoa-web-language", "invalid");
  mountUi();
  expect(model.settings.language).toBe("de");
  expect(document.title).toBe("Gorogoa");
});

test("语言、RTL、焦点与 Escape 返回由真实组件管理", async () => {
  mountUi();
  await nextTick();
  await click("language-open");
  expect(model.ui.page).toBe("language");
  expect(document.activeElement.getAttribute("lang")).toBe("zh-CN");
  expect(element("language-list").children).toHaveLength(18);
  element("language-list").querySelector('[lang="ar"]').click();
  await flushPromises();
  expect(model.settings.language).toBe("ar");
  expect(browser.store.get("gorogoa-web-language")).toBe("ar");
  expect(document.documentElement.lang).toBe("ar");
  expect(element("game-menu").dir).toBe("rtl");
  expect(document.activeElement).toBe(element("language-open"));
  await click("language-open");
  await escape();
  expect(model.ui.page).toBe("settings");
  expect(model.actions.toggleMenu).not.toHaveBeenCalled();
  await escape();
  expect(model.ui.paused).toBe(false);
  expect(element("game-menu").getAttribute("aria-hidden")).toBe("true");
  expect(element("board").inert).toBe(false);
});

test("音量与提示统一持久化，外部设置值保留必要校验", async () => {
  browser.store.set("gorogoa-web-language", "invalid");
  browser.store.set("gorogoa-web-volume-music", "NaN");
  browser.store.set("gorogoa-web-unlocked-chapter", "100");
  mountUi();
  model.actions.setVolume = vi.fn();
  expect(model.settings.language).toBe("zh-CN");
  expect(model.settings.volumeMusic).toBe(1);
  expect(model.settings.maxChapter).toBe(1);
  await nextTick();
  await click("show-hints");
  expect(model.settings.showHints).toBe(false);
  expect(element("board").dataset.hints).toBe("off");
  expect(browser.store.get("gorogoa-web-visual-hints")).toBe("off");
  element("volume-music").value = "0.35";
  element("volume-music").dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(model.settings.volumeMusic).toBe(0.35);
  expect(browser.store.get("gorogoa-web-volume-music")).toBe("0.35");
  expect(model.actions.setVolume).toHaveBeenCalledWith("music", 0.35);
});

test("无全屏 API 时禁用按钮并解释能力限制", async () => {
  mountUi();
  await nextTick();
  expect(element("game-fullscreen").disabled).toBe(true);
  expect(element("fullscreen-unavailable").textContent).toBe(
    model.t("fullscreenError"),
  );
});

test("全屏失败不误勾选，成功与外部退出均按实际状态同步", async () => {
  let fullscreen = null;
  Object.defineProperties(document, {
    fullscreenEnabled: { configurable: true, value: true },
    fullscreenElement: { configurable: true, get: () => fullscreen },
    exitFullscreen: {
      configurable: true,
      value: vi.fn(async () => {
        fullscreen = null;
      }),
    },
  });
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("denied"))
    .mockImplementation(async () => {
      fullscreen = document.documentElement;
    });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  mountUi();
  await nextTick();
  await click("game-fullscreen");
  expect(model.ui.fullscreen).toBe(false);
  expect(element("game-fullscreen").checked).toBe(false);
  expect(model.ui.settingsStatus).toBe(model.t("fullscreenError"));
  await click("game-fullscreen");
  expect(model.ui.fullscreen).toBe(true);
  expect(element("game-fullscreen").checked).toBe(true);
  fullscreen = null;
  document.dispatchEvent(new Event("fullscreenchange"));
  await nextTick();
  expect(element("game-fullscreen").checked).toBe(false);
});

test("章节取消保留存档，确认只载入一次；菜单过渡不改变 Canvas 宿主", async () => {
  browser.store.set("gorogoa-web-progress-v1", "existing-save");
  mountUi();
  const canvas = element("game");
  let finish;
  model.actions.loadChapter = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await nextTick();
  element("chapter-list").children[0].click();
  await nextTick();
  expect(model.ui.pendingChapter).toBe(0);
  await click("menu-cancel");
  expect(browser.store.get("gorogoa-web-progress-v1")).toBe("existing-save");
  expect(model.actions.loadChapter).not.toHaveBeenCalled();
  element("chapter-list").children[0].click();
  await nextTick();
  const loading = model.actions.confirmChapter();
  await model.actions.confirmChapter();
  await nextTick();
  expect(element("menu-ok").disabled).toBe(true);
  expect(element("menu-cancel").disabled).toBe(true);
  expect(model.actions.loadChapter).toHaveBeenCalledExactlyOnceWith(0);
  finish();
  await loading;
  await nextTick();
  expect(model.ui.chapterBusy).toBe(false);
  expect(element("game")).toBe(canvas);
  expect(element("startup")).toBeTruthy();
  expect(element("ending")).toBeTruthy();
});

test("credits 并发与成功请求共用，失败后允许显式重试", async () => {
  const data = { pages: [{ lines: [{ text: "<script>不是 HTML</script>" }] }] };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal("fetch", fetch);
  mountUi();
  await Promise.all([
    model.actions.openCredits(),
    model.resources.loadCredits(),
  ]);
  await nextTick();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(element("settings-credits-lines").textContent).toContain(
    "<script>不是 HTML</script>",
  );
  expect(element("settings-credits-lines").querySelector("script")).toBeNull();
  await model.actions.openCredits();
  expect(fetch).toHaveBeenCalledTimes(1);
  const resources = createResources(document.baseURI);
  fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(resources.loadCredits()).rejects.toThrow("offline");
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  await expect(resources.loadCredits()).resolves.toEqual(data);
  expect(fetch).toHaveBeenCalledTimes(3);
});

async function bootRuntime() {
  model = createGameUi();
  wrapper = mount(App, { props: { model }, attachTo: document.body });
  await startGame(model);
  await nextTick();
}
function mockAudio() {
  const log = [];
  vi.spyOn(AudioBank.prototype, "resume").mockImplementation(async function () {
    log.push("resume");
    if (!this.context) {
      const context = { state: "running" };
      context.suspend = vi.fn(async () => {
        context.state = "suspended";
      });
      context.close = vi.fn(async () => {
        context.state = "closed";
      });
      this.context = context;
    }
    this.context.state = "running";
  });
  vi.spyOn(AudioBank.prototype, "play").mockImplementation(async function (
    name,
    options = {},
  ) {
    if (options.shouldPlay && !options.shouldPlay()) return null;
    return { stop: vi.fn(() => options.onEnd?.()) };
  });
  vi.spyOn(SoundtrackDirector.prototype, "suspend").mockImplementation(
    function () {
      return this.bank.context.suspend();
    },
  );
  vi.spyOn(SoundtrackDirector.prototype, "syncLocation").mockImplementation(
    () => {},
  );
  vi.spyOn(SoundtrackDirector.prototype, "syncScore").mockImplementation(
    () => {},
  );
  return log;
}
test("声音在网络请求前解锁，成功才保存，忙碌状态阻止重复操作", async () => {
  const log = mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  let release;
  const fetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url) => {
    if (new URL(url).pathname.endsWith("events.json")) {
      log.push("events");
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return fetch(url);
  });
  const pending = model.actions.toggleSound();
  await flushPromises();
  await model.actions.toggleSound();
  expect(log).toEqual(["resume", "resume", "events"]);
  expect(model.ui.soundBusy).toBe(true);
  expect(element("sound").disabled).toBe(true);
  expect(element("sound").textContent.trim()).toBe(model.t("loading"));
  release();
  await pending;
  await nextTick();
  expect(model.settings.soundMuted).toBe(false);
  expect(browser.store.get("gorogoa-web-sound")).toBe("on");
  expect(element("sound").textContent.trim()).toBe(model.t("soundOff"));
  await model.actions.toggleSound();
  expect(browser.store.get("gorogoa-web-sound")).toBe("off");
});

test("声音解锁失败不误写设置，用户可再次启用", async () => {
  mockAudio();
  vi.spyOn(AudioBank.prototype, "resume").mockRejectedValueOnce(
    new Error("blocked"),
  );
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await model.actions.toggleSound();
  await nextTick();
  expect(model.settings.soundMuted).toBe(true);
  expect(browser.store.get("gorogoa-web-sound")).toBe("off");
  expect(model.ui.soundLabel).toBe("retrySound");
  expect(element("sound").disabled).toBe(false);
  await model.actions.toggleSound();
  expect(model.ui.soundLabel).toBe("soundOff");
});

test("界面上下文解锁失败也不保存启用设置，随后可重试", async () => {
  mockAudio();
  const resume = AudioBank.prototype.resume;
  resume.mockImplementationOnce(resume.getMockImplementation());
  resume.mockRejectedValueOnce(new Error("UI blocked"));
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await model.actions.toggleSound();
  expect(model.settings.soundMuted).toBe(true);
  expect(browser.store.get("gorogoa-web-sound")).toBe("off");
  expect(model.ui.soundBusy).toBe(false);
  expect(model.ui.soundLabel).toBe("retrySound");
  await model.actions.toggleSound();
  expect(model.settings.soundMuted).toBe(false);
  expect(model.ui.soundLabel).toBe("soundOff");
});

test("启用请求中销毁界面，不再启用音效或写入偏好", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  let release;
  const fetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url) => {
    if (new URL(url).pathname.endsWith("events.json"))
      await new Promise((resolve) => {
        release = resolve;
      });
    return fetch(url);
  });
  const pending = model.actions.toggleSound();
  await flushPromises();
  model.dispose();
  release();
  await pending;
  expect(model.settings.soundMuted).toBe(true);
  expect(browser.store.get("gorogoa-web-sound")).toBe("off");
  expect(model.ui.soundBusy).toBe(false);
});

test("菜单动作播放明确反馈，内部重置不响，Escape 与按钮返回一致", async () => {
  mountUi();
  const play = vi.fn();
  model.actions.playUiSound = play;
  await nextTick();
  await click("language-open");
  expect(play).toHaveBeenLastCalledWith("select");
  await escape();
  expect(play).toHaveBeenLastCalledWith("back");
  play.mockClear();
  model.actions.resetMenu();
  model.actions.showSettings();
  expect(play).not.toHaveBeenCalled();
  await click("show-hints");
  expect(play).toHaveBeenLastCalledWith("back");
  await click("show-hints");
  expect(play).toHaveBeenLastCalledWith("select");
  await model.actions.requestChapter(0);
  expect(play).toHaveBeenLastCalledWith("select");
  await click("menu-cancel");
  expect(play).toHaveBeenLastCalledWith("back");
  model.actions.loadChapter = vi.fn();
  await model.actions.requestChapter(0);
  await model.actions.confirmChapter();
  expect(play).toHaveBeenLastCalledWith("back");
});

test("已保存声音开启时，首次打开菜单的手势也能解锁界面声音", async () => {
  const log = mockAudio();
  vi.stubGlobal("AudioContext", class {});
  browser.store.set("gorogoa-web-sound", "on");
  await bootRuntime();
  await browser.step(44);
  await nextTick();
  expect(log).toEqual([]);
  const play = vi.spyOn(InterfaceSounds.prototype, "play");
  const request = vi.spyOn(model.actions, "playUiSound");
  model.actions.toggleMenu();
  expect(log).toEqual(["resume", "resume"]);
  await request.mock.results[0].value;
  expect(model.ui.paused).toBe(true);
  expect(SoundtrackDirector.prototype.suspend).toHaveBeenCalled();
  expect(play).toHaveBeenCalledExactlyOnceWith("menu");
  const sounds = play.mock.instances[0];
  expect(sounds.enabled).toBe(true);
  expect(sounds.slots.size).toBe(1);
});

test("暂停菜单仍播放界面音效，滑块同步两套音量，静音与销毁清理音源", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await browser.step(44);
  await nextTick();
  await model.actions.toggleSound();
  const play = vi.spyOn(InterfaceSounds.prototype, "play");
  model.actions.toggleMenu();
  await flushPromises();
  expect(model.ui.paused).toBe(true);
  expect(SoundtrackDirector.prototype.suspend).toHaveBeenCalled();
  expect(play).toHaveBeenLastCalledWith("menu");
  const sounds = play.mock.instances[0];
  expect(sounds.bank.context.state).toBe("running");
  await click("language-open");
  expect(play).toHaveBeenLastCalledWith("select");
  expect(sounds.slots.size).toBe(2);
  await escape();
  const volume = vi.spyOn(AudioBank.prototype, "setChannelVolume");
  model.actions.setVolume("effects", 0.35);
  expect(volume.mock.calls).toEqual([
    ["effects", 0.35],
    ["effects", 0.35],
  ]);
  expect(play).toHaveBeenLastCalledWith("slide", { channel: "effects" });
  await model.actions.toggleSound();
  expect(sounds.slots.size).toBe(0);
  const bankPlay = AudioBank.prototype.play.mock.calls.length;
  await model.actions.playUiSound("menu");
  expect(AudioBank.prototype.play.mock.calls.length).toBe(bankPlay);
  await model.actions.toggleSound();
  expect(sounds.enabled).toBe(true);
  model.dispose();
  expect(sounds.enabled).toBe(false);
  expect(sounds.bank.context.close).toHaveBeenCalledTimes(1);
});

test("章节重建清理旧音效，菜单关闭反馈在清理后播放", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await browser.step(44);
  await nextTick();
  await model.actions.toggleSound();
  const play = vi.spyOn(InterfaceSounds.prototype, "play");
  model.actions.toggleMenu();
  await model.actions.requestChapter(0);
  const sounds = play.mock.instances[0];
  await model.actions.confirmChapter();
  await flushPromises();
  expect(model.ui.paused).toBe(false);
  expect(play).toHaveBeenLastCalledWith("menu");
  expect(sounds.slots.size).toBe(1);
  const slot = [...sounds.slots][0];
  expect(slot.handle.stop).not.toHaveBeenCalled();
});

test("棋盘空白 tap 按 REGION 热点提示，关闭提示、取消与拖动不响，导航不叠加", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await browser.step(44);
  await nextTick();
  await model.actions.toggleSound();
  const play = vi.spyOn(InterfaceSounds.prototype, "play");
  const board = element("board");
  const emit = (type, x = 0, y = 0) =>
    board.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        pointerType: "touch",
        bubbles: true,
      }),
    );
  emit("pointermove", 358, 358);
  for (let i = 0; i < 120 && model.ui.hotspots.length === 0; i++) {
    await browser.step();
    await nextTick();
  }
  expect(model.ui.hotspots.length).toBeGreaterThan(0);
  emit("pointerdown");
  emit("pointerup");
  expect(play).not.toHaveBeenCalled();
  element("hotspots").children[0].click();
  for (
    let i = 0;
    i < 120 && !model.ui.hotspots.some((hotspot) => !hotspot.image);
    i++
  ) {
    await browser.step();
    await nextTick();
  }
  expect(model.ui.hotspots.some((hotspot) => !hotspot.image)).toBe(true);
  emit("pointerdown");
  emit("pointerup");
  expect(play).toHaveBeenCalledExactlyOnceWith("ping", {
    shouldPlay: expect.any(Function),
  });
  play.mockClear();
  model.settings.showHints = false;
  emit("pointerdown");
  emit("pointerup");
  expect(play).not.toHaveBeenCalled();
  model.settings.showHints = true;
  emit("pointerdown");
  emit("pointercancel");
  emit("pointerup");
  expect(play).not.toHaveBeenCalled();
  emit("pointerdown");
  emit("pointerup", 20, 20);
  expect(play).not.toHaveBeenCalled();
  element("hotspots").children[0].click();
  expect(play).not.toHaveBeenCalled();
});

test("挂载销毁后移除监听与设置 watch，重复挂载不会重复响应", async () => {
  mountUi();
  const old = model;
  old.dispose();
  old.settings.language = "en";
  expect(browser.store.has("gorogoa-web-language")).toBe(false);
  await escape();
  expect(old.actions.toggleMenu).not.toHaveBeenCalled();
});

async function firstHotspot() {
  element("board").dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 358,
      clientY: 358,
      pointerId: 1,
      isPrimary: true,
    }),
  );
  for (let i = 0; i < 120 && model.ui.hotspots.length === 0; i++) {
    await browser.step();
    await nextTick();
  }
  expect(model.ui.hotspots.length).toBeGreaterThan(0);
  return model.ui.hotspots[0];
}

const startupStage = (key) =>
  model.ui.startupProgress.find((stage) => stage.key === key);
const startupMeter = () =>
  element("startup-progress").querySelector('[role="progressbar"]');
const startupPercent = () =>
  Number(startupMeter().getAttribute("aria-valuenow"));

test("单条进度按阶段完成比例聚合，首帧就绪前最高为 99%", async () => {
  mountUi();
  model.ui.startupActive = true;
  for (const [logos, data, scene, total, expected] of [
    [0, 0, 0, null, 0],
    [3, 1, 0, null, 44],
    [3, 3, 0, 4, 66],
    [3, 3, 1, 4, 75],
    [3, 3, 4, 4, 99],
    [3, 3, 0, 0, 99],
  ]) {
    model.ui.startupProgress = [
      { key: "loadingLogos", completed: logos, total: 3, failed: 0 },
      { key: "loadingData", completed: data, total: 3, failed: 0 },
      { key: "loadingScene", completed: scene, total, failed: 0 },
    ];
    await nextTick();
    expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(1);
    expect(startupPercent()).toBe(expected);
    expect(
      element("startup-progress").querySelector(".startup-progress-fill").style
        .width,
    ).toBe(`${expected}%`);
  }
  model.ui.loading = false;
  await nextTick();
  expect(startupPercent()).toBe(100);
  expect(element("startup-progress").hidden).toBe(false);
  model.ui.startupActive = false;
  await nextTick();
  expect(element("startup-progress").hidden).toBe(true);
});

test("启动进度按实际数据任务完成数更新，不随等待时间虚增", async () => {
  const fetch = globalThis.fetch;
  let release;
  vi.stubGlobal("fetch", async (url) => {
    if (new URL(url).pathname.endsWith("/assets/manifest.json"))
      await new Promise((resolve) => {
        release = resolve;
      });
    return fetch(url);
  });
  const pending = bootRuntime();
  await vi.waitFor(() => expect(startupStage("loadingData").completed).toBe(2));
  await nextTick();
  expect(element("startup-progress").hidden).toBe(false);
  expect(element("startup-progress").textContent).toContain(
    model.t("loadingData"),
  );
  expect(startupPercent()).toBe(55);
  expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(1);
  browser.time += 60;
  await browser.step(1, 0);
  expect(startupStage("loadingData").completed).toBe(2);
  expect(startupStage("loadingScene").total).toBeNull();
  expect(startupPercent()).toBe(55);
  release();
  await pending;
  expect(startupStage("loadingData").completed).toBe(3);
  await browser.step(1, 0);
  const scene = startupStage("loadingScene");
  expect(scene.total).toBeGreaterThan(0);
  expect(scene.completed).toBe(scene.total);
  expect(scene.failed).toBe(0);
  await nextTick();
  expect(model.ui.startupActive).toBe(true);
  expect(startupPercent()).toBe(100);
  expect(element("startup-progress").hidden).toBe(false);
  await browser.step(10);
  expect(element("startup").hidden).toBe(true);
  expect(element("startup-progress").hidden).toBe(true);
});

test("启动图片逐张解码更新进度，失败不计作成功，也不提前开始 Logo", async () => {
  const decodes = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    () => new Promise((resolve, reject) => decodes.push({ resolve, reject })),
  );
  await bootRuntime();
  expect(startupStage("loadingLogos")).toMatchObject({
    completed: 0,
    total: 3,
    failed: 0,
  });
  decodes[1].resolve();
  await flushPromises();
  expect(startupPercent()).toBe(44);
  browser.time += 30;
  await browser.step(1, 0);
  expect(element("startup").childElementCount).toBe(0);
  expect(startupStage("loadingLogos").completed).toBe(1);
  decodes[0].reject(new Error("图像无法解码"));
  await flushPromises();
  expect(startupStage("loadingLogos")).toMatchObject({
    completed: 1,
    failed: 1,
  });
  expect(element("startup-progress").textContent).toContain("失败 1");
  expect(startupPercent()).toBe(55);
  decodes[2].resolve();
  await flushPromises();
  expect(startupStage("loadingLogos")).toMatchObject({
    completed: 2,
    total: 3,
    failed: 1,
  });
  await browser.step(1, 0.5);
  expect(element("startup").firstElementChild.style.opacity).toBe("0.5");
});

test("首帧图集等待时进度可更新，实际绘制后显示 100% 再随启动页隐藏", async () => {
  await bootRuntime();
  const decodes = new Map();
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    function () {
      return new Promise((resolve) => decodes.set(this.src, resolve));
    },
  );
  await browser.step(23);
  const pending = browser.step();
  await vi.waitFor(() => expect(decodes.size).toBeGreaterThan(0));
  await nextTick();
  const total = startupStage("loadingScene").total;
  expect(total).toBeGreaterThan(0);
  expect(startupStage("loadingScene").completed).toBe(0);
  expect(startupPercent()).toBe(66);
  expect(startupMeter().getAttribute("aria-valuemax")).toBe("100");
  expect(element("startup-progress").hidden).toBe(false);
  expect(browser.pendingFrame).toBe(false);
  browser.setHidden(true);
  for (const resolve of decodes.values()) resolve();
  await pending;
  await nextTick();
  expect(startupStage("loadingScene").completed).toBe(total);
  expect(model.ui.loading).toBe(true);
  expect(startupPercent()).toBe(99);
  expect(element("startup-progress").hidden).toBe(false);
  browser.time += 30;
  browser.setHidden(false);
  await browser.step(1, 0);
  await nextTick();
  expect(startupStage("loadingScene").completed).toBe(total);
  expect(model.ui.loading).toBe(false);
  expect(startupPercent()).toBe(100);
  expect(element("startup-progress").hidden).toBe(false);
  // 保留末张 Logo 的淡入与停留，以及 Logo、背景各 1 秒的淡出。
  await browser.step(4, 1);
  await nextTick();
  expect(element("startup-progress").hidden).toBe(true);
});

test("启动中销毁会清理进度，迟到的数据与图片不再回写", async () => {
  const fetch = globalThis.fetch;
  let release;
  vi.stubGlobal("fetch", async (url) => {
    if (new URL(url).pathname.endsWith("runtime-project.json"))
      await new Promise((resolve) => {
        release = resolve;
      });
    return fetch(url);
  });
  const decodes = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    () => new Promise((resolve) => decodes.push(resolve)),
  );
  const pending = bootRuntime();
  await vi.waitFor(() => expect(startupStage("loadingData").completed).toBe(2));
  model.dispose();
  await nextTick();
  expect(model.ui.startupProgress).toEqual([]);
  expect(element("startup-progress").hidden).toBe(true);
  for (const resolve of decodes) resolve();
  release();
  await pending;
  await flushPromises();
  expect(model.ui.startupProgress).toEqual([]);
  expect(model.ui.ready).toBe(false);
  expect(browser.pendingFrame).toBe(false);
  expect(browser.observerCount).toBe(0);
});

test("启动数据失败保留原错误提示，迟到任务不会把进度写成完成", async () => {
  const loadProject = vi.spyOn(projectModel, "loadProject");
  const fetch = globalThis.fetch;
  let release;
  vi.stubGlobal("fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/assets/manifest.json")) throw new Error("offline");
    if (path.endsWith("runtime-project.json"))
      await new Promise((resolve) => {
        release = resolve;
      });
    return fetch(url);
  });
  await bootRuntime();
  const progress = model.ui.startupProgress;
  expect(model.ui.loadFailed).toBe(true);
  expect(element("startup-progress").hidden).toBe(true);
  expect(element("loading").textContent).toContain(model.t("loadError"));
  release();
  await loadProject.mock.results[0].value;
  await flushPromises();
  expect(model.ui.startupProgress).toBe(progress);
  expect(model.ui.ready).toBe(false);
});

test("图集进度按唯一 URL 计数，缓存复用和失败不改变原渲染行为", async () => {
  mountUi();
  const texture = {
    key: "progress",
    url: atlasUrl("progress"),
    width: 16,
    height: 16,
  };
  const renderer = new SceneRenderer(
    {},
    { textures: [texture] },
    { entries: [] },
  );
  const item = {
    source: "progress.png",
    region: {
      textureUrl: texture.url,
      textureKey: texture.key,
      u: 0,
      v: 0,
      w: 16,
      h: 16,
    },
    matrix: [1, 0, 0, 1, 0, 0],
    dest: [0, 0, 16, 16],
    alpha: 1,
  };
  const context = element("game").getContext("2d");
  const onTextureLoaded = vi.fn();
  const decode = vi.spyOn(HTMLImageElement.prototype, "decode");
  const report = () => ({ drawn: [item, { ...item }], missing: [] });
  await renderer.render(context, "unused", {
    report: report(),
    onTextureLoaded,
  });
  expect(onTextureLoaded).toHaveBeenCalledExactlyOnceWith(texture.url, true);
  expect(decode).toHaveBeenCalledTimes(1);
  await renderer.render(context, "unused", {
    report: report(),
    onTextureLoaded,
  });
  expect(onTextureLoaded).toHaveBeenCalledTimes(2);
  expect(decode).toHaveBeenCalledTimes(1);
  renderer.atlas.remove(texture.url);
  decode.mockRejectedValueOnce(new Error("解码失败"));
  const missing = report();
  await renderer.render(context, "unused", {
    report: missing,
    onTextureLoaded,
  });
  expect(onTextureLoaded).toHaveBeenCalledTimes(3);
  expect(onTextureLoaded).toHaveBeenLastCalledWith(texture.url, false);
  expect(missing.missing).toHaveLength(2);
});

test("单条加载进度支持全部语言和 RTL，未知阶段保留零进度", async () => {
  mountUi();
  model.ui.startupActive = true;
  model.ui.startupProgress = [
    { key: "loadingScene", completed: 0, total: null, failed: 0 },
  ];
  for (const code of Object.keys(model.languages)) {
    model.settings.language = code;
    for (const key of [
      "loadingLogos",
      "loadingData",
      "loadingScene",
      "loadingFailed",
    ])
      expect(model.t(key)).not.toBe(key);
  }
  model.settings.language = "ar";
  await nextTick();
  expect(element("startup-progress").dir).toBe("rtl");
  expect(startupPercent()).toBe(0);
  expect(element("startup-progress").textContent).toContain(
    model.t("loadingScene"),
  );
  expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(1);
});

test("启动页 Anime.js 时间线保持原版 Logo 顺序、线性淡入淡出和末页等待", async () => {
  mountUi();
  const startup = new StartupScreen(element("startup"), {}, document.baseURI);
  await flushPromises();
  for (const [time, index, opacity] of [
    [0, 0, 0],
    [0.5, 0, 0.5],
    [1.5, 0, 1],
    [2.5, 0, 0.5],
    [3, 1, 0],
    [3.5, 1, 0.5],
    [5.5, 1, 0.5],
    [6, 2, 0],
    [6.5, 2, 0.5],
    [7, 2, 1],
    [15, 2, 1],
  ]) {
    startup.update(time, false);
    expect(startup.index).toBe(index);
    expect(Number(element("startup").firstElementChild.style.opacity)).toBe(
      opacity,
    );
    expect(startup.active).toBe(true);
  }
  expect(startup.timeline.animation.paused).toBe(true);
  expect(engine.useDefaultMainLoop).toBe(false);
  browser.setHidden(true);
  browser.time += 60;
  browser.setHidden(false);
  expect(browser.pendingFrame).toBe(false);
  expect(engine.reqId).toBe(0);
  startup.finish();
});

test("启动图像解码完成后才计时，解码失败也等待其余图像", async () => {
  mountUi();
  const decodes = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    () => new Promise((resolve, reject) => decodes.push({ resolve, reject })),
  );
  let time = 0;
  const startup = new StartupScreen(
    element("startup"),
    {},
    document.baseURI,
    undefined,
    { now: () => time },
  );
  time = 20;
  startup.update(time, true);
  expect(startup.started).toBeUndefined();
  expect(startup.index).toBe(-1);
  decodes[0].reject(new Error("图像无法解码"));
  decodes[1].resolve();
  await flushPromises();
  expect(startup.started).toBeUndefined();
  decodes[2].resolve();
  await flushPromises();
  expect(startup.started).toBe(20);
  startup.update(20.5, true);
  expect(startup.index).toBe(0);
  expect(startup.images[0].style.opacity).toBe("0.5");
  startup.finish();
});

test("启动页资源迟到时，从就绪时刻安排 Logo 与背景的连续淡出", async () => {
  mountUi();
  const startup = new StartupScreen(element("startup"), {}, document.baseURI);
  await flushPromises();
  startup.update(15, false);
  startup.update(15, true);
  expect(startup.lastFade).toBe(15);
  expect(Number(startup.images[2].style.opacity)).toBe(1);
  startup.update(15.25, true);
  expect(Number(startup.images[2].style.opacity)).toBe(0.75);
  startup.update(16, true);
  expect(Number(startup.images[2].style.opacity)).toBe(0);
  expect(Number(startup.button.style.opacity)).toBe(1);
  startup.update(16.5, true);
  expect(Number(startup.button.style.opacity)).toBe(0.5);
  expect(startup.active).toBe(true);
  startup.update(17, true);
  expect(startup.button.hidden).toBe(true);
  expect(startup.active).toBe(false);
  expect(startup.timeline.animation.paused).toBe(true);
  expect(engine.reqId).toBe(0);
});

function createCreditsScreen() {
  const root = document.createElement("div");
  const page = document.createElement("div");
  const previous = document.createElement("button");
  const next = document.createElement("button");
  root.append(page, previous, next);
  document.body.append(root);
  const screen = new EndingCredits(root, page, previous, next, {});
  const data = {
    fadeIn: 0.5,
    fadeOut: 0.5,
    spacing: 0,
    pages: [1, 2, 1].map((hold, index) => ({
      hold,
      lines: [{ style: "Heading", text: `第 ${index + 1} 页`, offset: 0 }],
    })),
  };
  screen.start(data, 10);
  return { screen, data, root, page, previous, next };
}

test("片尾名单 Anime.js 时间线保持淡入、停留、淡出和自动翻页时序", () => {
  const { screen, page } = createCreditsScreen();
  for (const [time, index, opacity] of [
    [10, 0, 0],
    [10.25, 0, 0.5],
    [10.5, 0, 1],
    [11.5, 0, 1],
    [11.75, 0, 0.5],
    [12, 1, 0],
    [12.25, 1, 0.5],
  ]) {
    screen.update(time);
    expect(screen.index).toBe(index);
    expect(page.firstElementChild.textContent).toBe(`第 ${index + 1} 页`);
    expect(Number(page.style.opacity)).toBe(opacity);
    expect(screen.timeline.animation.paused).toBe(true);
  }
  expect(engine.reqId).toBe(0);
  screen.reset();
});

test("片尾名单手动前后翻页重新淡入，并换用新一页时间线", () => {
  const { screen, page, previous, next } = createCreditsScreen();
  screen.update(10.25);
  const first = screen.timeline;
  next.click();
  expect(screen.timeline).not.toBe(first);
  expect(screen.index).toBe(1);
  expect(page.style.opacity).toBe("0");
  screen.update(10.5);
  expect(Number(page.style.opacity)).toBe(0.5);
  const second = screen.timeline;
  previous.click();
  expect(screen.timeline).not.toBe(second);
  expect(screen.index).toBe(0);
  expect(page.style.opacity).toBe("0");
  expect(previous.hidden).toBe(true);
  screen.reset();
});

test("片尾名单跨多页跳帧、结束、重新开始和重置后不再更新", () => {
  const { screen, data, root, page } = createCreditsScreen();
  screen.update(16.25);
  expect(screen.index).toBe(2);
  expect(screen.pageStarted).toBe(15);
  expect(page.style.opacity).toBe("1");
  screen.update(16.75);
  expect(Number(page.style.opacity)).toBe(0.5);
  screen.update(17);
  expect(root.hidden).toBe(true);
  expect(Number(page.style.opacity)).toBe(0.5);
  screen.start(data, 20);
  screen.update(20.25);
  expect(root.hidden).toBe(false);
  expect(screen.index).toBe(0);
  expect(Number(page.style.opacity)).toBe(0.5);
  screen.reset();
  expect(screen.data).toBeNull();
  expect(root.hidden).toBe(true);
  screen.update(100);
  expect(root.hidden).toBe(true);
  expect(Number(page.style.opacity)).toBe(0.5);
  expect(engine.reqId).toBe(0);
});

test("手机横屏居中棋盘保持正方形，触摸按屏幕偏移映射到游戏坐标", async () => {
  const step = vi.spyOn(RuntimeState.prototype, "step");
  browser.resize(300, 300, 2);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({
    left: 180,
    top: 8,
    width: 300,
    height: 300,
  });
  await bootRuntime();
  await browser.step(44);
  expect(element("game").width).toBe(600);
  expect(element("game").height).toBe(600);
  element("board").dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 330,
      clientY: 158,
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
    }),
  );
  const state = step.mock.instances.at(-1);
  expect(state.hovered.has(state.project.tree.attrs.staringCard)).toBe(true);
});

test("手机竖向视口旋转横屏舞台后，非中心触摸仍映射到原卡片", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true });
  const step = vi.spyOn(RuntimeState.prototype, "step");
  vi.spyOn(GameMotion.prototype, "position").mockReturnValue([0, 0]);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({ left: 20, top: 40, width: 300, height: 300 });
  await bootRuntime();
  await browser.step(44);
  const offset = CARD_SIZE / (2 * BOARD_SIZE);
  element("board").dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 20 + 300 * (1 - offset),
      clientY: 40 + 300 * offset,
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
    }),
  );
  const state = step.mock.instances.at(-1);
  expect(state.hovered.has(state.project.tree.attrs.staringCard)).toBe(true);
});

test("启动页后台停帧，恢复保留 Logo 与淡入进度", async () => {
  await bootRuntime();
  await browser.step(2);
  const image = element("startup").firstElementChild;
  const opacity = image.style.opacity;
  browser.setHidden(true);
  browser.time += 60;
  expect(browser.pendingFrame).toBe(false);
  browser.setHidden(false);
  await browser.step(1, 0);
  expect(element("startup").firstElementChild).toBe(image);
  expect(image.style.opacity).toBe(opacity);
  expect(model.ui.startupActive).toBe(true);
});

test("游戏转场与脚本时钟不计后台时间，pagehide/pageshow 同样冻结", async () => {
  const update = vi.spyOn(ProjectScripts.prototype, "update");
  await bootRuntime();
  await browser.step(44);
  const hotspot = await firstHotspot();
  model.actions.navigate(hotspot.card, hotspot.id);
  await browser.step(1, 0.1);
  const time = update.mock.calls.at(-1)[1];
  const location = element("game").dataset.locations;
  window.dispatchEvent(new Event("pagehide"));
  browser.time += 80;
  expect(browser.pendingFrame).toBe(false);
  window.dispatchEvent(new Event("pageshow"));
  await browser.step(1, 0);
  expect(update.mock.calls.at(-1)[1]).toBeCloseTo(time);
  expect(element("game").dataset.locations).toBe(location);
  await browser.step(12);
  expect(element("game").dataset.locations).not.toBe(location);
});

test("导航运动在菜单和后台冻结但不取消，恢复沿用同一个运动", async () => {
  const update = vi.spyOn(GameMotion.prototype, "update");
  await bootRuntime();
  await browser.step(44);
  const hotspot = await firstHotspot();
  model.actions.navigate(hotspot.card, hotspot.id);
  await browser.step(1, 0.1);
  const motion = update.mock.instances.at(-1);
  const move = motion.navigation;
  const fraction = move.sample.fraction;
  model.actions.toggleMenu();
  await browser.step(4);
  browser.setHidden(true);
  browser.time += 60;
  browser.setHidden(false);
  await browser.step(2);
  expect(motion.navigation).toBe(move);
  expect(move.sample.fraction).toBe(fraction);
  model.actions.toggleMenu();
  await browser.step(1, 0);
  expect(move.sample.fraction).toBe(fraction);
  await browser.step(12);
  expect(motion.navigation).toBeNull();
  expect(move.sample.complete).toBe(true);
  expect(engine.reqId).toBe(0);
});

test.each(["重建", "销毁"])(
  "导航绘制解码中%s：取消旧运动并拒绝发布旧 RuntimeState 的帧",
  async (action) => {
    const update = vi.spyOn(GameMotion.prototype, "update");
    const commit = vi.spyOn(RuntimeState.prototype, "setLocation");
    await bootRuntime();
    await browser.step(44);
    const hotspot = await firstHotspot();
    const publish = vi.spyOn(element("game").getContext("2d"), "drawImage");
    let release;
    vi.spyOn(SceneRenderer.prototype, "render").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    model.actions.navigate(hotspot.card, hotspot.id);
    const pending = browser.step(1, 0.01);
    expect(release).toBeTypeOf("function");
    const motion = update.mock.instances.at(-1);
    expect(motion.navigation).not.toBeNull();
    commit.mockClear();
    if (action === "重建") await model.actions.loadChapter(0);
    else model.dispose();
    expect(motion.navigation).toBeNull();
    expect(motion.busy).toBe(false);
    release();
    await pending;
    expect(publish).not.toHaveBeenCalled();
    motion.update(100);
    expect(commit).not.toHaveBeenCalled();
    if (action === "重建") {
      await browser.step();
      expect(publish).toHaveBeenCalled();
    } else expect(browser.pendingFrame).toBe(false);
  },
);

test("后台暂停两套音频且清理短音效，恢复保留手动暂停与静音", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  await browser.step(44);
  await model.actions.toggleSound();
  const play = vi.spyOn(InterfaceSounds.prototype, "play");
  model.actions.toggleMenu();
  await flushPromises();
  const sounds = play.mock.instances[0];
  const gameBank = SoundtrackDirector.prototype.suspend.mock.instances[0].bank;
  const stop = vi.spyOn(SoundtrackDirector.prototype, "stop");
  browser.setHidden(true);
  await flushPromises();
  expect(gameBank.context.state).toBe("suspended");
  expect(sounds.bank.context.state).toBe("suspended");
  expect(sounds.slots.size).toBe(0);
  await model.actions.playUiSound("menu");
  expect(sounds.slots.size).toBe(0);
  browser.time += 40;
  browser.setHidden(false);
  await flushPromises();
  expect(model.ui.paused).toBe(true);
  expect(gameBank.context.state).toBe("suspended");
  expect(sounds.bank.context.state).toBe("running");
  expect(stop).not.toHaveBeenCalled();
  model.actions.toggleMenu();
  await flushPromises();
  expect(gameBank.context.state).toBe("running");
  await model.actions.toggleSound();
  browser.setHidden(true);
  browser.setHidden(false);
  await flushPromises();
  expect(gameBank.context.state).toBe("suspended");
  expect(sounds.bank.context.state).toBe("suspended");
});

test("异步声音解锁跨入后台后仍暂停，不因网络完成而偷跑", async () => {
  mockAudio();
  browser.store.set("gorogoa-web-sound", "off");
  await bootRuntime();
  const resume = AudioBank.prototype.resume.getMockImplementation();
  let release, bank;
  AudioBank.prototype.resume.mockImplementationOnce(async function () {
    bank = this;
    await new Promise((resolve) => {
      release = resolve;
    });
    await resume.call(this);
  });
  const enabled = model.actions.toggleSound();
  browser.setHidden(true);
  release();
  await enabled;
  expect(bank.context.state).toBe("suspended");
  browser.setHidden(false);
  await flushPromises();
  expect(bank.context.state).toBe("running");
});

test("解码等待期间隐藏不发布旧帧，快速恢复与销毁不重复安排 RAF", async () => {
  await bootRuntime();
  await browser.step(44);
  const context = element("game").getContext("2d");
  const publish = vi.spyOn(context, "drawImage");
  let release;
  vi.spyOn(SceneRenderer.prototype, "render").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  browser.resize(320, 320, 2);
  const pending = browser.step();
  expect(release).toBeTypeOf("function");
  browser.setHidden(true);
  browser.time += 20;
  release();
  await pending;
  expect(publish).not.toHaveBeenCalled();
  expect(browser.pendingFrame).toBe(false);
  browser.setHidden(false);
  browser.setHidden(true);
  browser.setHidden(false);
  await browser.step();
  expect(publish).toHaveBeenCalledTimes(1);
  SceneRenderer.prototype.render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  browser.resize(350, 350, 2);
  const resumed = browser.step();
  browser.setHidden(true);
  browser.time += 20;
  browser.setHidden(false);
  expect(browser.pendingFrame).toBe(false);
  release();
  await resumed;
  expect(browser.pendingFrame).toBe(true);
  expect(publish).toHaveBeenCalledTimes(2);
  model.dispose();
  expect(browser.pendingFrame).toBe(false);
  expect(browser.observerCount).toBe(0);
  browser.setHidden(true);
  browser.setHidden(false);
  browser.resize(360, 360);
  expect(browser.pendingFrame).toBe(false);
});

test.each([
  [320, 1, 320],
  [320, 2, 640],
  [320, 3, 640],
  [1000, 3, BOARD_SIZE * 2],
])("显示宽度 %i、DPR %i 的棋盘分辨率为 %i", async (width, dpr, expected) => {
  browser.resize(width, width, dpr);
  await bootRuntime();
  await browser.step(44);
  expect(element("game").width).toBe(expected);
  expect(element("game").height).toBe(expected);
});

test("旋转、像素比变化与零尺寸保持棋盘比例，不影响触摸坐标", async () => {
  const step = vi.spyOn(RuntimeState.prototype, "step");
  browser.resize(320, 320, 1);
  const render = vi.spyOn(SceneRenderer.prototype, "render");
  await bootRuntime();
  await browser.step(44);
  expect(render.mock.calls.at(-1)[2].rasterScale).toBeCloseTo(320 / BOARD_SIZE);
  browser.resize(360, 360, 2);
  await browser.step();
  expect(element("game").width).toBe(720);
  browser.resize(0, 0);
  await browser.step();
  expect(element("game").width).toBe(720);
  browser.resize(360, 360, 1);
  await browser.step();
  expect(element("game").width).toBe(360);
  vi.stubGlobal("devicePixelRatio", 2);
  await browser.step();
  expect(element("game").width).toBe(720);
  element("board").dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 180,
      clientY: 180,
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
    }),
  );
  const state = step.mock.instances.at(-1);
  expect(state.hovered.has(state.project.tree.attrs.staringCard)).toBe(true);
  for (let i = 0; i < 120 && model.ui.hotspots.length === 0; i++)
    await browser.step();
  expect(model.ui.hotspots.length).toBeGreaterThan(0);
});

test("热点的鼠标、触摸与键盘意图均触发预取但不导航", async () => {
  mountUi();
  model.ui.paused = false;
  model.ui.hotspots = [
    { id: "next", card: "card", label: "explore", rect: [0, 0, 10, 10] },
  ];
  const prefetch = (model.actions.prefetchNavigation = vi.fn());
  model.actions.navigate = vi.fn();
  await nextTick();
  const hotspot = element("hotspots").firstElementChild;
  hotspot.dispatchEvent(new PointerEvent("pointerenter"));
  hotspot.dispatchEvent(
    new PointerEvent("pointerdown", { pointerType: "touch" }),
  );
  hotspot.focus();
  expect(prefetch.mock.calls).toEqual(Array(3).fill(["card", "next"]));
  expect(model.actions.navigate).not.toHaveBeenCalled();
});

test("下一场景预测只请求纹理，不提前改变卡片位置、目标或脚本", async () => {
  let state;
  const step = RuntimeState.prototype.step;
  vi.spyOn(RuntimeState.prototype, "step").mockImplementation(function (
    ...args
  ) {
    state = this;
    return step.apply(this, args);
  });
  const prefetch = vi
    .spyOn(AtlasStore.prototype, "prefetch")
    .mockResolvedValue([]);
  await bootRuntime();
  await browser.step(44);
  const hotspot = await firstHotspot();
  const location = new Map(state.locations),
    targets = new Map(state.targets);
  const update = vi.spyOn(ProjectScripts.prototype, "update");
  const startMotion = vi.spyOn(GameMotion.prototype, "start");
  model.actions.prefetchNavigation(hotspot.card, hotspot.id);
  expect(prefetch).toHaveBeenCalledTimes(1);
  expect(prefetch.mock.calls[0][0].length).toBeGreaterThan(0);
  expect(state.locations).toEqual(location);
  expect(state.targets).toEqual(targets);
  expect(update).not.toHaveBeenCalled();
  expect(startMotion).not.toHaveBeenCalled();
  browser.setHidden(true);
  model.actions.prefetchNavigation(hotspot.card, hotspot.id);
  expect(prefetch).toHaveBeenCalledTimes(1);
  browser.setHidden(false);
  model.actions.navigate(hotspot.card, hotspot.id);
  expect(prefetch).toHaveBeenCalledTimes(2);
});

const MiB = 1024 * 1024;
function atlasStore(options = {}) {
  return new AtlasStore(
    {
      textures: ["a", "b", "c", "d", "huge"].map((key) => ({
        key,
        url: `assets/textures/${key}.png`,
        width: key === "huge" ? 4096 : 512,
        height: key === "huge" ? 4096 : 512,
      })),
    },
    { entries: [] },
    { baseUrl: document.baseURI, ...options },
  );
}
const atlasUrl = (key) => `assets/textures/${key}.png`;

test("首次在后台加载只准备数据，前台从第一张 Logo 开始", async () => {
  browser.setHidden(true);
  await bootRuntime();
  browser.time += 80;
  expect(browser.pendingFrame).toBe(false);
  browser.setHidden(false);
  await browser.step(1, 0);
  expect(element("startup").firstElementChild.alt).toBe(
    "Annapurna Interactive",
  );
  expect(model.ui.startupActive).toBe(true);
});

test("菜单暂停与后台冻结叠加后，关闭菜单不重复扣除时间", async () => {
  const update = vi.spyOn(ProjectScripts.prototype, "update");
  await bootRuntime();
  await browser.step(44);
  const time = update.mock.calls.at(-1)[1];
  model.actions.toggleMenu();
  await browser.step(2);
  browser.setHidden(true);
  browser.time += 70;
  browser.setHidden(false);
  await browser.step(2, 5);
  model.actions.toggleMenu();
  await browser.step(1, 0);
  expect(update.mock.calls.at(-1)[1]).toBeCloseTo(time);
});

test("启动序曲随后台暂停，恢复保留同一音源及播放进度", async () => {
  mockAudio();
  vi.stubGlobal("AudioContext", class {});
  vi.spyOn(AudioBank.prototype, "load").mockResolvedValue({
    buffer: { duration: 100 },
  });
  const enable = vi.spyOn(StartupScreen.prototype, "enableMusic");
  await bootRuntime();
  await browser.step(2);
  element("startup").click();
  await enable.mock.results[0].value;
  const startup = enable.mock.instances[0];
  const track = startup.track;
  expect(track).toBeTruthy();
  browser.setHidden(true);
  browser.time += 60;
  await flushPromises();
  expect(startup.bank.context.state).toBe("suspended");
  expect(track.stop).not.toHaveBeenCalled();
  browser.setHidden(false);
  await flushPromises();
  await browser.step(1, 0);
  expect(startup.bank.context.state).toBe("running");
  expect(startup.track).toBe(track);
});

test("启动声音解锁中销毁，迟到的上下文也被关闭", async () => {
  mockAudio();
  vi.stubGlobal("AudioContext", class {});
  const enable = vi.spyOn(StartupScreen.prototype, "enableMusic");
  await bootRuntime();
  await browser.step(2);
  const resume = AudioBank.prototype.resume.getMockImplementation();
  let release;
  AudioBank.prototype.resume.mockImplementationOnce(resume);
  AudioBank.prototype.resume.mockImplementationOnce(async function () {
    await new Promise((resolve) => {
      release = resolve;
    });
    await resume.call(this);
  });
  element("startup").click();
  model.dispose();
  release();
  await enable.mock.results[0].value;
  const startup = enable.mock.instances[0];
  expect(startup.active).toBe(false);
  expect(startup.bank.context.state).toBe("closed");
  expect(startup.bank.context.close).toHaveBeenCalledTimes(1);
  expect(browser.pendingFrame).toBe(false);
});

test("片尾动画和名单使用冻结时钟，结局画布的像素密度也限制为 2", async () => {
  const draw = vi.spyOn(EndingScreen.prototype, "draw");
  const update = vi.spyOn(EndingCredits.prototype, "update");
  await bootRuntime();
  const gl = new Proxy(
    {
      TEXTURE0: 1000,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  Object.defineProperties(element("ending"), {
    clientWidth: { value: 360 },
    clientHeight: { value: 600 },
    getContext: { value: (type) => (type === "webgl" ? gl : null) },
  });
  vi.stubGlobal("devicePixelRatio", 3);
  await browser.step(44);
  await model.actions.loadChapter(6);
  for (let i = 0; i < 240 && draw.mock.calls.length === 0; i++)
    await browser.step();
  expect(draw).toHaveBeenCalled();
  const elapsed = draw.mock.calls.at(-1)[0];
  browser.setHidden(true);
  browser.time += 60;
  browser.setHidden(false);
  await browser.step(1, 0);
  expect(draw.mock.calls.at(-1)[0]).toBeCloseTo(elapsed);
  expect(element("ending").width).toBe(720);
  expect(element("ending").height).toBe(1200);
  for (let i = 0; i < 240 && element("credits").hidden; i++)
    await browser.step();
  expect(element("credits").hidden).toBe(false);
  await browser.step(1, 0.25);
  const credits = update.mock.instances.at(-1);
  const creditsTime = update.mock.calls.at(-1)[0];
  const opacity = element("credits-page").style.opacity;
  browser.setHidden(true);
  browser.time += 60;
  browser.setHidden(false);
  await browser.step(1, 0);
  expect(update.mock.calls.at(-1)[0]).toBeCloseTo(creditsTime);
  expect(element("credits-page").style.opacity).toBe(opacity);
  model.actions.toggleMenu();
  await browser.step(4);
  model.actions.toggleMenu();
  await browser.step(1, 0);
  expect(update.mock.calls.at(-1)[0]).toBeCloseTo(creditsTime);
  expect(element("credits-page").style.opacity).toBe(opacity);
  expect(engine.reqId).toBe(0);
  model.dispose();
  expect(credits.data).toBeNull();
  expect(element("credits").hidden).toBe(true);
});

test("默认图集预算为 128 MiB，小图不再受 16 张缓存上限限制", async () => {
  const textures = Array.from({ length: 20 }, (_, key) => ({
    key: String(key),
    url: atlasUrl(key),
    width: 512,
    height: 512,
  }));
  const store = new AtlasStore(
    { textures },
    { entries: [] },
    { baseUrl: document.baseURI },
  );
  await Promise.all(
    textures.map(({ url }) => store.image({ textureUrl: url })),
  );
  expect(store.cacheBudget).toBe(128 * MiB);
  expect(store.images.size).toBe(20);
  expect(store.cachedBytes).toBe(20 * MiB);
});

test("大小图按解码字节计算，超预算时淘汰非活动 LRU", async () => {
  const store = atlasStore({ cacheBudget: 65 * MiB });
  await store.image({ textureUrl: atlasUrl("a") });
  await store.image({ textureUrl: atlasUrl("b") });
  expect(store.cachedBytes).toBe(2 * MiB);
  store.retainActive([atlasUrl("b")]);
  await store.image({ textureUrl: atlasUrl("huge") });
  expect([...store.images.keys()]).toEqual([atlasUrl("b"), atlasUrl("huge")]);
  expect(store.cachedBytes).toBe(65 * MiB);
  expect(store.lastUsed.has(atlasUrl("a"))).toBe(false);
});

test("活动集合可以超过软预算，离开大图后释放内存且超限时不预取", async () => {
  const store = atlasStore({ cacheBudget: 2 * MiB });
  store.retainActive([atlasUrl("a"), atlasUrl("huge")]);
  await store.image({ textureUrl: atlasUrl("a") });
  await store.image({ textureUrl: atlasUrl("huge") });
  expect(store.cachedBytes).toBe(65 * MiB);
  await store.prefetch([atlasUrl("b")]);
  expect(store.images.has(atlasUrl("b"))).toBe(false);
  expect(store.images.has(atlasUrl("huge"))).toBe(true);
  store.retainActive([atlasUrl("a")]);
  expect(store.cachedBytes).toBe(MiB);
  expect([...store.images.keys()]).toEqual([atlasUrl("a")]);
});

test("在途解码计入预算并复用，完成后释放超预算的非活动图集", async () => {
  const store = atlasStore({ cacheBudget: MiB });
  await store.image({ textureUrl: atlasUrl("a") });
  store.retainActive([atlasUrl("a")]);
  let release;
  const decode = vi
    .spyOn(HTMLImageElement.prototype, "decode")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  decode.mockClear();
  const pending = store.image({ textureUrl: atlasUrl("b") });
  expect(store.image({ textureUrl: atlasUrl("b") })).toBe(pending);
  expect(store.cachedBytes).toBe(2 * MiB);
  expect(store.prune()).toBe(false);
  expect(store.pending.has(atlasUrl("b"))).toBe(true);
  await store.prefetch([atlasUrl("c")]);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(store.images.has(atlasUrl("c"))).toBe(false);
  release();
  await pending;
  expect(store.pending.size).toBe(0);
  expect(store.cachedBytes).toBe(MiB);
  expect([...store.images.keys()]).toEqual([atlasUrl("a")]);
});

test("预取大图会腾出全部所需字节，而不只淘汰一张小图", async () => {
  const store = atlasStore({ cacheBudget: 64 * MiB, prefetchBudget: 64 * MiB });
  for (const key of ["a", "b", "c"])
    await store.image({ textureUrl: atlasUrl(key) });
  expect(store.cachedBytes).toBe(3 * MiB);
  await store.prefetch([atlasUrl("huge")]);
  expect([...store.images.keys()]).toEqual([atlasUrl("huge")]);
  expect(store.cachedBytes).toBe(64 * MiB);
  expect(store.prefetched.size).toBe(1);
  expect(store.lastUsed.size).toBe(1);
});

test("无法容纳的预取不会清空缓存，仍能继续预取较小图集", async () => {
  const store = atlasStore({ cacheBudget: 2 * MiB, prefetchBudget: 64 * MiB });
  await store.image({ textureUrl: atlasUrl("a") });
  await store.image({ textureUrl: atlasUrl("b") });
  const decode = vi.spyOn(HTMLImageElement.prototype, "decode").mockClear();
  await store.prefetch([atlasUrl("huge")]);
  expect([...store.images.keys()]).toEqual([atlasUrl("a"), atlasUrl("b")]);
  expect(decode).not.toHaveBeenCalled();
  await store.prefetch([atlasUrl("huge"), atlasUrl("c")]);
  expect([...store.images.keys()]).toEqual([atlasUrl("b"), atlasUrl("c")]);
  expect(store.cachedBytes).toBe(2 * MiB);
  expect(decode).toHaveBeenCalledTimes(1);
});

test("预取最多两张图集，已有与在途资源复用，不抢占活动缓存", async () => {
  const store = atlasStore({ cacheBudget: 3 * MiB });
  await store.image({ textureUrl: atlasUrl("a") });
  store.retainActive([atlasUrl("a")]);
  const releases = [];
  const decode = vi
    .spyOn(HTMLImageElement.prototype, "decode")
    .mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
  decode.mockClear();
  const pending = store.prefetch([atlasUrl("b"), atlasUrl("c"), atlasUrl("d")]);
  store.prefetch([atlasUrl("b"), atlasUrl("c"), atlasUrl("d")]);
  const reused = store.image({ textureUrl: atlasUrl("b") });
  expect(decode).toHaveBeenCalledTimes(2);
  expect(store.pending.size).toBe(2);
  expect(store.images.has(atlasUrl("a"))).toBe(true);
  store.prune();
  expect(store.images.has(atlasUrl("b"))).toBe(true);
  releases.forEach((release) => release());
  await pending;
  await reused;
  expect(store.images.size).toBe(3);
  expect(store.cachedBytes).toBe(3 * MiB);
});

test("预取解码预算限制大图，缓存满时只淘汰非活动 LRU", async () => {
  const store = atlasStore({
    cacheBudget: 2 * MiB,
    prefetchBudget: MiB,
  });
  await store.image({ textureUrl: atlasUrl("a") });
  await store.image({ textureUrl: atlasUrl("b") });
  store.retainActive([atlasUrl("b")]);
  await store.prefetch([atlasUrl("huge"), atlasUrl("c"), atlasUrl("d")]);
  expect(store.images.has(atlasUrl("a"))).toBe(false);
  expect(store.images.has(atlasUrl("b"))).toBe(true);
  expect(store.images.has(atlasUrl("c"))).toBe(true);
  expect(store.images.has(atlasUrl("d"))).toBe(false);
  expect(store.images.has(atlasUrl("huge"))).toBe(false);
  store.retainActive([atlasUrl("b"), atlasUrl("c")]);
  await store.prefetch([atlasUrl("d")]);
  expect(store.images.has(atlasUrl("d"))).toBe(false);
});

test("改变目标清理未使用的预取，失败图集允许正式绘制重试", async () => {
  const store = atlasStore();
  const decode = vi
    .spyOn(HTMLImageElement.prototype, "decode")
    .mockResolvedValue();
  await store.prefetch([atlasUrl("a"), atlasUrl("b")]);
  expect(store.cachedBytes).toBe(2 * MiB);
  await store.prefetch([atlasUrl("c")]);
  expect(store.images.has(atlasUrl("a"))).toBe(false);
  expect(store.images.has(atlasUrl("b"))).toBe(false);
  expect(store.cachedBytes).toBe(MiB);
  decode.mockRejectedValueOnce(new Error("offline"));
  await store.prefetch([atlasUrl("d")]);
  expect(store.images.has(atlasUrl("d"))).toBe(false);
  expect(store.cachedBytes).toBe(0);
  expect(store.pending.size).toBe(0);
  expect(store.prefetched.size).toBe(0);
  await store.image({ textureUrl: atlasUrl("d") });
  expect(store.images.has(atlasUrl("d"))).toBe(true);
  expect(store.cachedBytes).toBe(MiB);
});

test.each([0.75, 1.5, 2])(
  "遮罩、阴影与雾效合成画布按 %f 比例栅格化",
  async (rasterScale) => {
    browser.captureDrawing();
    const renderer = new SceneRenderer({}, { textures: [] }, { entries: [] });
    const fill = {
      kind: "fill",
      alpha: 1,
      matrix: [1, 0, 0, 1, 0, 0],
      color: "#fff",
      dest: [0, 0, CARD_SIZE, CARD_SIZE],
      haze: [1, 1, 1, 0.5],
    };
    const image = {
      ...fill,
      kind: undefined,
      region: { textureUrl: atlasUrl("a") },
    };
    vi.spyOn(renderer.atlas, "image").mockResolvedValue(new Image());
    vi.spyOn(renderer.atlas, "crop").mockReturnValue([0, 0, 1, 1]);
    const report = {
      drawn: [
        image,
        fill,
        {
          kind: "mask",
          matrix: fill.matrix,
          alpha: 1,
          mask: [fill],
          children: [fill],
        },
        {
          kind: "shadow",
          matrix: fill.matrix,
          alpha: 1,
          caster: [fill],
          receiver: [fill],
          fillWithBlack: true,
          haze: fill.haze,
        },
      ],
      missing: [],
    };
    await renderer.render(
      document.createElement("canvas").getContext("2d"),
      "test",
      { report, rasterScale },
    );
    const pixels = Math.ceil(CARD_SIZE * rasterScale);
    expect(browser.surfaces.length).toBeGreaterThan(6);
    for (const surface of browser.surfaces) {
      expect(surface.width).toBe(pixels);
      expect(surface.height).toBe(pixels);
      expect(surface.context.scale).toHaveBeenCalledWith(
        pixels / CARD_SIZE,
        pixels / CARD_SIZE,
      );
      for (const call of surface.context.setTransform.mock.calls)
        expect(call).toEqual([
          pixels / CARD_SIZE,
          0,
          0,
          pixels / CARD_SIZE,
          0,
          0,
        ]);
    }
  },
);
