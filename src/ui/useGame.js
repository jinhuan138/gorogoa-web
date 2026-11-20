import {
  effectScope,
  nextTick,
  onScopeDispose,
  shallowReactive,
  watch,
} from "vue";
import { languages, translate } from "../i18n/index.js";
import { createResources } from "../resources/json.js";
import { useSettings } from "./useSettings.js";

export function createGameUi() {
  const scope = effectScope();
  return scope.run(() => {
    const preferences = useSettings();
    const settings = preferences.settings;
    const resources = createResources(document.baseURI);
    const ui = shallowReactive({
      ready: false,
      startupActive: true,
      paused: false,
      phase: "PROLOGUE",
      loading: true,
      loadFailed: false,
      notice: "",
      hotspots: [],
      textures: new Map(),
      page: "settings",
      settingsStatus: "",
      pendingChapter: null,
      chapterBusy: false,
      soundBusy: false,
      soundLabel: "soundOn",
      fullscreen: false,
      fullscreenSupported: Boolean(
        document.fullscreenEnabled &&
          document.documentElement.requestFullscreen,
      ),
      creditsLines: [],
    });
    const t = (key, number) => translate(settings.language, key, number);
    const focus = async (selector) => {
      await nextTick();
      document.querySelector(selector).focus();
    };
    function page(name, sound) {
      if (sound && ui.page !== name) actions.playUiSound(sound);
      ui.page = name;
      ui.settingsStatus = "";
    }
    const actions = {
      playUiSound() {},
      resetMenu() {
        page("settings");
      },
      showSettings() {
        if (ui.chapterBusy) return;
        page("settings", "back");
      },
      toggleHints() {
        actions.playUiSound(settings.showHints ? "select" : "back");
      },
      async openLanguages() {
        page("language", "select");
        await focus('#language-list [aria-pressed="true"]');
      },
      async chooseLanguage(code) {
        settings.language = code;
        page("settings", "back");
        await focus("#language-open");
      },
      async openCredits() {
        page("credits", "menu");
        try {
          const data = await resources.loadCredits();
          ui.creditsLines = data.pages.flatMap((entry) =>
            entry.lines.map((line) => line.text),
          );
        } catch (error) {
          if (ui.page === "credits") ui.settingsStatus = t("loadError");
          console.warn("制作人员名单载入失败", error);
        }
      },
      exitToTitle() {
        page("title", "menu");
        return focus("#title-resume");
      },
      requestChapter(chapter) {
        ui.pendingChapter = chapter;
        page("confirm", "select");
        return focus("#menu-cancel");
      },
      async confirmChapter() {
        if (ui.chapterBusy) return;
        actions.playUiSound("back");
        ui.chapterBusy = true;
        try {
          await actions.loadChapter(ui.pendingChapter);
        } finally {
          ui.pendingChapter = null;
          ui.chapterBusy = false;
        }
      },
      async toggleFullscreen() {
        actions.playUiSound("select");
        ui.settingsStatus = "";
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        } catch (error) {
          ui.settingsStatus = t("fullscreenError");
          console.warn("全屏切换失败", error);
        } finally {
          ui.fullscreen = Boolean(document.fullscreenElement);
        }
      },
    };
    watch(
      () => settings.language,
      (code) => {
        document.documentElement.lang = code;
      },
      { immediate: true },
    );
    const syncFullscreen = () => {
      ui.fullscreen = Boolean(document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("fullscreenerror", syncFullscreen);
    const onKeydown = (event) => {
      if (
        event.key !== "Escape" ||
        !ui.ready ||
        ui.startupActive ||
        ui.phase === "ENDING"
      )
        return;
      event.preventDefault();
      if (ui.paused && ["confirm", "language", "credits"].includes(ui.page))
        actions.showSettings();
      else actions.toggleMenu();
    };
    document.addEventListener("keydown", onKeydown);
    onScopeDispose(() => {
      actions.disposeInterfaceSounds?.();
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("fullscreenerror", syncFullscreen);
      document.removeEventListener("keydown", onKeydown);
    });
    return {
      ui,
      settings,
      preferences,
      resources,
      actions,
      t,
      languages,
      dispose: () => scope.stop(),
    };
  });
}
