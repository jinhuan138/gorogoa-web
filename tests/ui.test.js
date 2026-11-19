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
import { createBrowser } from "./helpers/browser.js";

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
    this.context = { state: "running" };
  });
  vi.spyOn(SoundtrackDirector.prototype, "suspend").mockResolvedValue();
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
  expect(log).toEqual(["resume", "events"]);
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

test("挂载销毁后移除监听与设置 watch，重复挂载不会重复响应", async () => {
  mountUi();
  const old = model;
  old.dispose();
  old.settings.language = "en";
  expect(browser.store.has("gorogoa-web-language")).toBe(false);
  await escape();
  expect(old.actions.toggleMenu).not.toHaveBeenCalled();
});
