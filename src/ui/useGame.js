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
    function page(name) {
      ui.page = name;
      ui.settingsStatus = "";
    }
    const actions = {
      showSettings() {
        page("settings");
      },
      async openLanguages() {
        page("language");
        await focus('#language-list [aria-pressed="true"]');
      },
      async chooseLanguage(code) {
        settings.language = code;
        page("settings");
        await focus("#language-open");
      },
      async openCredits() {
        page("credits");
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
        page("title");
        return focus("#title-resume");
      },
      requestChapter(chapter) {
        ui.pendingChapter = chapter;
        page("confirm");
        return focus("#menu-cancel");
      },
      async confirmChapter() {
        if (ui.chapterBusy) return;
        ui.chapterBusy = true;
        try {
          await actions.loadChapter(ui.pendingChapter);
        } finally {
          ui.pendingChapter = null;
          ui.chapterBusy = false;
        }
      },
      async toggleFullscreen() {
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
        page("settings");
      else actions.toggleMenu();
    };
    document.addEventListener("keydown", onKeydown);
    onScopeDispose(() => {
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
