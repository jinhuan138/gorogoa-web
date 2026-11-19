import { reactive, watch } from "vue";
import { supportsLanguage } from "../i18n/index.js";

import { SAVE_KEY } from "../engine/model/storage.js";
const keys = {
  language: "gorogoa-web-language",
  showHints: "gorogoa-web-visual-hints",
  soundMuted: "gorogoa-web-sound",
  maxChapter: "gorogoa-web-unlocked-chapter",
  volumeMusic: "gorogoa-web-volume-music",
  volumeEffects: "gorogoa-web-volume-effects",
};

function openStorage() {
  try {
    return globalThis.localStorage;
  } catch (error) {
    console.warn("浏览器存储不可用，设置仅在本次会话中生效", error);
    return null;
  }
}

export function useSettings() {
  const storage = openStorage();
  function access(method, key, value) {
    if (!storage) return null;
    try {
      return storage[method](key, value);
    } catch (error) {
      console.warn(`浏览器存储操作失败 ${key}`, error);
      return null;
    }
  }
  const savedLanguage = access("getItem", keys.language);
  const savedChapter = Number(access("getItem", keys.maxChapter));
  const volume = (key) => {
    const value = Number(access("getItem", key) ?? 1);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
  };
  const settings = reactive({
    language: supportsLanguage(savedLanguage) ? savedLanguage : "zh-CN",
    showHints: access("getItem", keys.showHints) !== "off",
    soundMuted: access("getItem", keys.soundMuted) === "off",
    maxChapter:
      Number.isInteger(savedChapter) && savedChapter >= 1 && savedChapter <= 6
        ? savedChapter
        : 1,
    volumeMusic: volume(keys.volumeMusic),
    volumeEffects: volume(keys.volumeEffects),
  });
  for (const field of [
    "language",
    "showHints",
    "maxChapter",
    "volumeMusic",
    "volumeEffects",
  ]) {
    watch(
      () => settings[field],
      (value) => {
        access(
          "setItem",
          keys[field],
          field === "showHints" ? (value ? "on" : "off") : String(value),
        );
      },
      { flush: "sync" },
    );
  }
  return {
    settings,
    storage,
    removeSave: () => access("removeItem", SAVE_KEY),
    rememberSound: () =>
      access("setItem", keys.soundMuted, settings.soundMuted ? "off" : "on"),
  };
}
