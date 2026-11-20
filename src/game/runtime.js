import { GameMotion } from "./motion.js";
import { AudioBank } from "../engine/audio/audio.js";
import { SoundtrackDirector } from "../engine/audio/soundtrack.js";
import { InterfaceSounds } from "../engine/audio/interface.js";
import {
  planTransition,
  sampleTransition,
  hotspotRegion,
} from "../engine/model/navigation.js";
import { SAVE_KEY, readSave, writeSave } from "../engine/model/storage.js";
import { resolveHoleContent } from "../engine/model/holes.js";
import { LinkModel } from "../engine/model/links.js";
import {
  BOARD_INSET,
  BOARD_SIZE,
  CELLS,
  centerCard,
  cellPosition,
  cardAt,
  currentStoryPhase,
  nextStoryPhase,
  beginCardDrag,
  cancelCardDrag,
  planCardDrop,
  finishCardDrop,
} from "../engine/model/board.js";
import { loadChapterCheckpoint, loadProject } from "../engine/model/project.js";
import { SceneRenderer, reportTextureUrls } from "../engine/render/renderer.js";
import { RuntimeState } from "../engine/model/state.js";
import { ProjectScripts } from "../engine/model/scripts.js";
import { EndingScreen } from "./screens/ending.js";
import { EndingCredits } from "./screens/credits.js";
import { StartupScreen, STARTUP_SLIDES } from "./screens/startup.js";
import { CARD_SIZE } from "../engine/render/camera.js";
import {
  UI_STYLE_TEXTURES,
  createTextureUrls,
  cssImage,
} from "../resources/textures.js";
import { markStartup, reportStartup } from "../resources/startup-timing.js";

export async function startGame({
  ui,
  settings,
  preferences,
  resources,
  actions,
  t,
}) {
  markStartup("game-start");
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const boardFrame = document.createElement("canvas");
  boardFrame.width = boardFrame.height = canvas.width;
  const frameContext = boardFrame.getContext("2d");
  const board = document.getElementById("board");
  const rotatedMobileStage = window.matchMedia(
    "(pointer: coarse) and (orientation: portrait)",
  );
  const endingCanvas = document.getElementById("ending");
  const pauseButton = document.getElementById("pause");
  const soundBank = new AudioBank({ baseUrl: document.baseURI });
  const interfaceBank = new AudioBank({ baseUrl: document.baseURI });
  const interfaceSounds = new InterfaceSounds(interfaceBank);
  let backgrounded = document.hidden;
  let pageHidden = false;
  let hiddenAt = backgrounded ? performance.now() : null;
  let hiddenDuration = 0;
  let disposed = false;
  ui.startupProgress = [
    ["loadingLogos", STARTUP_SLIDES.length],
    ["loadingData", 3],
    ["loadingScene", null],
  ].map(([key, total]) => ({ key, completed: 0, total, failed: 0 }));
  function updateStartupProgress(key, completed, total, failed = 0) {
    if (disposed || !ui.startupActive || ui.loadFailed) return;
    ui.startupProgress = ui.startupProgress.map((stage) =>
      stage.key === key ? { key, completed, total, failed } : stage,
    );
  }
  let frameRequest = null;
  let frameRunning = false;
  let uiSoundGeneration = 0;
  let rasterScale = canvas.width / BOARD_SIZE;
  let density = 0;
  let resizePending = true;
  const listeners = [];
  const pageNow = () => (hiddenAt ?? performance.now()) - hiddenDuration;
  function listen(target, type, callback) {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  }
  actions.playUiSound = async (name) => {
    if (settings.soundMuted || disposed || backgrounded) return;
    const generation = uiSoundGeneration;
    if (!soundDirector) {
      if (!(globalThis.AudioContext || globalThis.webkitAudioContext)) return;
      const snapshot = state;
      await setSound(true);
      if (state !== snapshot) return;
    }
    if (disposed || backgrounded || generation !== uiSoundGeneration) return;
    return interfaceSounds.play(name);
  };
  actions.disposeInterfaceSounds = () =>
    interfaceSounds
      .dispose()
      .catch((error) => console.warn("界面音频关闭失败", error));
  const startupButton = document.getElementById("startup");
  const gameShell = document.getElementById("game-shell");
  const startup = new StartupScreen(
    startupButton,
    soundBank,
    document.baseURI,
    () => t("gameName"),
    {
      now: () => pageNow() / 1000,
      isPaused: () => backgrounded || disposed,
      onProgress: (completed, total, failed) =>
        updateStartupProgress("loadingLogos", completed, total, failed),
      resume: async () => {
        await unlockBank(soundBank);
        await syncAudioBank(
          soundBank,
          () => backgrounded || settings.soundMuted,
        );
      },
    },
  );
  let bootReady = false;
  let soundDirector, audioFocus, lastCardsInPlay;
  const read = resources.read;
  const saveStorage = preferences.storage;
  let lastSavedVersion = -1;
  let chapterMilestones = [];
  let margins = [];
  let activeMargin = null;
  let pausedAt = null;
  soundBank.setChannelVolume("music", settings.volumeMusic);
  soundBank.setChannelVolume("effects", settings.volumeEffects);
  for (const [channel, value] of [
    ["music", settings.volumeMusic],
    ["effects", settings.volumeEffects],
  ]) {
    interfaceBank.setChannelVolume(channel, value);
    interfaceSounds.initializeSlider(channel, value);
  }
  actions.setVolume = (channel, volume) => {
    soundBank.setChannelVolume(channel, volume);
    interfaceBank.setChannelVolume(channel, volume);
    if (!backgrounded && !disposed)
      interfaceSounds.adjustVolume(channel, volume, pageNow() / 1000);
  };
  let project,
    state,
    links,
    scripts,
    renderer,
    manifest,
    epoch = pageNow(),
    dirty = true,
    drag = null,
    press = null,
    tap = null,
    lastHotspotKey = "",
    lastStateVersion = -1;
  let blockedCards = new Set();
  let textureUrls = new Map();
  let endingScreen,
    endingStarted = null,
    titleFadeStarted = null,
    creditsPredicate,
    creditsScreen,
    creditsData;
  let creditsRequested = false;
  const graphicTimes = new Map(),
    layerStatus = new Map();
  const directionAngle = {
    LEFT_BUTTON: 90,
    RIGHT_BUTTON: -90,
    UP_BUTTON: 180,
    DOWN_BUTTON: 0,
  };
  const hotspotLabel = {
    BACK_BUTTON: "retreat",
    LEFT_BUTTON: "left",
    RIGHT_BUTTON: "right",
    UP_BUTTON: "up",
    DOWN_BUTTON: "down",
  };
  const now = () =>
    startup.active ? 0 : ((pausedAt ?? pageNow()) - epoch) / 1000;
  const motion = new GameMotion({
    navigation: (move) => state.setLocation(move.card, move.destination),
    flight: ({ drag: drop, plan }) => {
      const lowerCard = cardAt(state, plan.cell);
      if (finishCardDrop(links, drop, plan)) {
        if (
          state.captors.get(lowerCard) === drop.draggedGUID &&
          state.captureSides.get(lowerCard) === "UNDER"
        )
          audioFocus = drop.draggedGUID;
        soundDirector?.playInterface("int_drop_card");
      }
    },
    opening: ({ guid, cell }) => links.place(guid, cell),
    closing: ({ guid }) => links.place(guid, CELLS[0]),
  });
  const showNotice = (message) => {
    ui.notice = message;
  };
  const showGrid = () =>
    state.storyPhase === "CHAPTERS" || Boolean(motion.closing);
  const inputBusy = () =>
    disposed ||
    backgrounded ||
    startup.active ||
    pausedAt !== null ||
    Boolean(drag || motion.busy);
  const canMove = (guid) => !blockedCards.has(guid);
  function cards() {
    const front =
      drag?.draggedGUID ||
      motion.flight?.drag.draggedGUID ||
      motion.closing?.guid;
    return [...state.inPlay]
      .filter(
        (guid) =>
          guid === front ||
          guid === motion.opening?.guid ||
          state.coords.has(guid),
      )
      .sort((a, b) => Number(a === front) - Number(b === front))
      .map((guid) => ({
        guid,
        location: state.locations.get(guid),
        coords: state.coords.get(guid),
      }));
  }
  function placement(card) {
    if (drag?.draggedGUID === card.guid) return drag.topLeft;
    return (
      motion.position(card.guid) ??
      (showGrid() ? cellPosition(card.coords) : centerCard())
    );
  }
  function displayCoords(guid) {
    return motion.displayCoords(guid, drag) ?? state.coords.get(guid);
  }
  function logicalPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (rotatedMobileStage.matches)
      return [y * BOARD_SIZE, (1 - x) * BOARD_SIZE];
    return [x * BOARD_SIZE, y * BOARD_SIZE];
  }
  function hitCard(point) {
    return cards()
      .reverse()
      .find((card) => {
        const [x, y] = placement(card);
        return (
          point[0] >= x &&
          point[0] < x + CARD_SIZE &&
          point[1] >= y &&
          point[1] < y + CARD_SIZE
        );
      });
  }
  function activeTransitions(card) {
    return state
      .getTransitions(card.guid)
      .filter((t) => t.attrs.hotspotStyle !== "NONE");
  }
  function updateButtons() {
    const visible = inputBusy()
      ? []
      : cards()
          .filter((card) => canMove(card.guid))
          .flatMap((card) =>
            activeTransitions(card).map((transition) => ({ card, transition })),
          );
    const key = visible
      .map(
        ({ card, transition }) =>
          transition.attrs.guid + ":" + placement(card).join(","),
      )
      .join("|");
    if (key === lastHotspotKey) return;
    lastHotspotKey = key;
    const hotspots = [];
    for (const { card, transition } of visible) {
      const style = transition.attrs.hotspotStyle;
      const [cx, cy] = placement(card);
      let rect = hotspotRegion(transition);
      const directional = style.endsWith("_BUTTON");
      if (directional)
        rect = [rect[0], rect[1], 40 / CARD_SIZE, 40 / CARD_SIZE];
      hotspots.push({
        id: transition.attrs.guid,
        card: card.guid,
        label: directional ? hotspotLabel[style] : "explore",
        image: directional
          ? style === "BACK_BUTTON"
            ? "hs_back_button"
            : "hs_button"
          : null,
        angle: style === "BACK_BUTTON" ? 0 : directionAngle[style],
        rect: [
          ((cx + rect[0] * CARD_SIZE) / BOARD_SIZE) * 100,
          ((cy + rect[1] * CARD_SIZE) / BOARD_SIZE) * 100,
          ((rect[2] * CARD_SIZE) / BOARD_SIZE) * 100,
          ((rect[3] * CARD_SIZE) / BOARD_SIZE) * 100,
        ],
      });
    }
    ui.hotspots = hotspots;
  }
  function prefetchPlan(plan) {
    const reports = [renderer.buildDrawList(plan.destination.attrs.guid)];
    if (plan.durationSeconds > 0)
      reports.push(
        renderer.buildDrawList(plan.fromLocation.attrs.guid, {
          viewpoint: sampleTransition(plan, plan.durationSeconds / 2).viewpoint,
          transitionLocations: plan.locations,
        }),
      );
    return renderer.atlas.prefetch(reportTextureUrls(reports));
  }
  actions.prefetchNavigation = (card, transition) => {
    if (!state || inputBusy() || !canMove(card)) return;
    const target = project.get(transition);
    if (!state.getTransitions(card).includes(target)) return;
    try {
      return prefetchPlan(planTransition(project, target));
    } catch (error) {
      console.warn("下一场景预取未完成", error);
    }
  };
  function navigate(card, transition) {
    if (inputBusy()) return;
    if (transition.attrs.hotspotStyle !== "NONE" && !canMove(card.guid)) return;
    if (!state.getTransitions(card.guid).includes(transition)) return;
    try {
      const plan = planTransition(project, transition);
      prefetchPlan(plan);
      state.targets.set(card.guid, transition.attrs.guid);
      if (plan.durationSeconds > 0) audioFocus = card.guid;
      motion.start(
        "navigation",
        {
          card: card.guid,
          destination: plan.destination.attrs.guid,
          plan,
        },
        now(),
      );
      board.dataset.cursor = "wait";
      dirty = true;
      showNotice("");
    } catch (error) {
      showNotice(t("transitionError"));
      console.warn(error);
    }
  }
  function followCapturedTransitions() {
    if (!motion.navigation) return;
    const target = state.targets.get(motion.navigation.card);
    for (const guid of state.captors.keys()) {
      const transition = state.getTransitions(guid).find((candidate) => {
        if (
          candidate.attrs.hotspotStyle !== "NONE" ||
          candidate.attrs.transitionDuration !== "0"
        )
          return false;
        const predicate = project.container(candidate, "predicate")[0];
        return project
          .container(predicate, "predicates")
          .some((condition) => condition.attrs.subject === target);
      });
      if (transition) state.setLocation(guid, transition.attrs.destLocation);
    }
  }
  function setHover(event) {
    if (!state || backgrounded || disposed) return;
    const card = hitCard(logicalPoint(event)),
      old = [...state.hovered].join(",");
    state.hovered.clear();
    if (card) state.hovered.add(card.guid);
    if (old !== [...state.hovered].join(",")) dirty = true;
    updateBoardCursor();
  }
  let waitingForBoardTextures = false;
  function updateBoardCursor() {
    const hovered = [...state.hovered][0];
    const waiting =
      waitingForBoardTextures || motion.busy || (hovered && !canMove(hovered));
    const canDrag = hovered && state.coords.has(hovered) && showGrid();
    board.dataset.cursor = drag
      ? "move"
      : waiting
        ? "wait"
        : canDrag
          ? "hand"
          : "default";
  }
  listen(board, "pointerdown", (event) => {
    if (!state || inputBusy() || !event.isPrimary || event.button !== 0) return;
    setHover(event);
    tap = event.target.closest(".hotspot")
      ? null
      : { id: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    if (state.storyPhase !== "CHAPTERS") return;
    const point = logicalPoint(event),
      card = hitCard(point);
    if (!card?.coords || !canMove(card.guid)) return;
    const origin = placement(card);
    press = {
      guid: card.guid,
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offset: point.map((v, i) => v - origin[i]),
    };
  });
  listen(board, "pointermove", (event) => {
    if (!state || !event.isPrimary) return;
    if (press && event.pointerId === press.id && !event.buttons && !drag)
      press = null;
    if (
      press &&
      event.pointerId === press.id &&
      !drag &&
      !inputBusy() &&
      canMove(press.guid) &&
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
        7
    ) {
      drag = {
        ...beginCardDrag(links, press.guid),
        offset: press.offset,
        id: press.id,
      };
      if (drag.direction === "OVER") {
        lastCardsInPlay.add(drag.draggedGUID);
        audioFocus = drag.revealedGUID;
      }
      board.setPointerCapture(event.pointerId);
      soundDirector?.playInterface("int_lift_card");
      press = tap = null;
    }
    if (drag && event.pointerId === drag.id) {
      drag.topLeft = logicalPoint(event).map((v, i) => v - drag.offset[i]);
      dirty = true;
      updateBoardCursor();
    } else setHover(event);
  });
  listen(board, "pointerleave", (event) => {
    // 触摸抬起也会触发离开；保留最后触及的卡片，让下一帧处理原版入场条件。
    if (state && !drag && event.pointerType !== "touch") {
      press = tap = null;
      state.hovered.clear();
      dirty = true;
      updateBoardCursor();
    }
  });
  function hintAt(point) {
    if (!settings.showHints || inputBusy()) return;
    const card = hitCard(point);
    const snapshot = state;
    const shouldPlay = () =>
      state === snapshot && !inputBusy() && settings.showHints;
    if (card && !canMove(card.guid)) {
      interfaceSounds.play("nonInteractive", { shouldPlay });
      return;
    }
    const candidates = card ? [card] : cards();
    if (
      candidates.some(
        (candidate) =>
          canMove(candidate.guid) &&
          activeTransitions(candidate).some(
            (transition) => transition.attrs.hotspotStyle === "REGION",
          ),
      )
    )
      interfaceSounds.play("ping", { shouldPlay });
    // 原版 m_sfxPingEmpty 未绑定素材，没有 REGION 热点时保持无声。
  }
  listen(board, "pointerup", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const tapped = event.pointerId === tap?.id ? tap : null;
    if (tapped) tap = null;
    if (event.pointerId === press?.id) press = null;
    if (event.pointerId !== drag?.id) {
      if (
        tapped &&
        Math.hypot(
          event.clientX - tapped.clientX,
          event.clientY - tapped.clientY,
        ) <= 7
      )
        hintAt(logicalPoint(event));
      return;
    }
    const current = drag;
    drag = null;
    const topLeft = logicalPoint(event).map((v, i) => v - current.offset[i]);
    const plan = planCardDrop(links, current, topLeft, canMove);
    if (plan) motion.start("flight", { drag: current, plan }, now());
    else cancelCardDrag(links, current);
    dirty = true;
  });
  function abandonPointer(event) {
    if (event.pointerId === tap?.id) tap = null;
    if (event.pointerId === press?.id) press = null;
    if (event.pointerId !== drag?.id) return;
    cancelCardDrag(links, drag);
    drag = null;
    dirty = true;
  }
  listen(board, "pointercancel", abandonPointer);
  listen(board, "lostpointercapture", (event) => {
    // 触摸的隐式捕获从子元素转交棋盘时，子元素的失去捕获事件也会冒泡。
    if (event.target === board) abandonPointer(event);
  });
  function cancelPointer() {
    const current = drag;
    drag = press = tap = null;
    if (!current) return;
    cancelCardDrag(links, current);
    if (board.hasPointerCapture(current.id))
      board.releasePointerCapture(current.id);
    dirty = true;
  }
  function restart({ restoreSaved = false, checkpoint = null } = {}) {
    if (!project) return;
    soundDirector?.stop();
    interfaceSounds.stop();
    epoch = pageNow();
    graphicTimes.clear();
    layerStatus.clear();
    blockedCards.clear();
    motion.cancel();
    drag = press = tap = null;
    scripts = new ProjectScripts(project);
    state = new RuntimeState(project, {
      scriptEvaluator: (definition, predicate) =>
        scripts.evaluate(definition, predicate),
      animationComplete: (container) => {
        const cached = layerStatus.get(container.attrs.guid);
        return cached
          ? cached.state === state.states.get(container.attrs.guid)
            ? cached.complete
            : null
          : true;
      },
      onChange: (change) => {
        dirty = true;
        if (change.kind === "state" && change.container.type === "SceneLayer") {
          layerStatus.set(change.container.attrs.guid, {
            state: change.state.attrs.guid,
            complete: null,
          });
          for (const guid of graphicTimes.keys())
            if (
              project.owner(project.get(guid), "LocationLayer")?.attrs
                .sceneLayer === change.container.attrs.guid
            )
              graphicTimes.delete(guid);
        }
      },
    });
    state.coords.set(project.tree.attrs.staringCard, [0, 0]);
    if (checkpoint) state.applyCheckpoint(checkpoint);
    else if (restoreSaved && saveStorage)
      readSave(saveStorage, SAVE_KEY, state);
    else preferences.removeSave();
    state.storyPhase = currentStoryPhase(state);
    ui.phase = state.storyPhase;
    endingStarted = state.storyPhase === "ENDING" ? -1.6 : null;
    titleFadeStarted = null;
    endingCanvas.hidden = true;
    creditsScreen?.reset();
    lastSavedVersion = -1;
    links = new LinkModel(project, state);
    links.refresh();
    lastCardsInPlay = new Set(state.inPlay);
    audioFocus = [...state.inPlay].at(-1);
    renderer.isSatisfied = (node) => state.isSatisfied(node);
    dirty = true;
    lastHotspotKey = null;
    showNotice("");
  }
  function textureUrl(name) {
    return textureUrls.get(name);
  }
  function showMenu(open, feedback = true) {
    if (disposed || startup.active || !state || open === (pausedAt !== null))
      return;
    if (open) {
      cancelPointer();
      pausedAt = pageNow();
      actions.resetMenu();
    } else {
      epoch += pageNow() - pausedAt;
      pausedAt = null;
    }
    ui.paused = open;
    if (feedback) actions.playUiSound("menu");
    updateAudioPause().catch((error) =>
      console.warn("声音暂停状态更新失败", error),
    );
    updateButtons();
    pauseButton.focus();
  }
  actions.toggleMenu = () => showMenu(pausedAt === null);
  actions.navigate = (card, transition) =>
    navigate({ guid: card }, project.get(transition));
  function updateMargin() {
    const next =
      margins.find(
        ({ predicate }) => predicate && state.isSatisfied(predicate) === true,
      ) ?? null;
    if (next === activeMargin) return;
    activeMargin = next;
    gameShell.dataset.margins = next ? "visible" : "hidden";
    if (!next) return;
    for (const [side, property] of [
      ["l", "left"],
      ["r", "right"],
      ["t", "top"],
      ["b", "bottom"],
    ]) {
      const name = next.attrs[`${property}ImageFilename`]?.replace(
        /\.png$/i,
        "",
      );
      const url = textureUrl(name);
      gameShell.style.setProperty(
        `--margin-${side}`,
        url ? `url("${url}")` : "none",
      );
    }
  }
  function unlockChapters() {
    const reached =
      chapterMilestones.findLastIndex(
        (predicate) => state.isSatisfied(predicate) === true,
      ) + 1;
    if (reached > settings.maxChapter) settings.maxChapter = reached;
  }
  actions.loadChapter = async (chapter) => {
    try {
      const checkpoint = chapter
        ? await loadChapterCheckpoint(chapter === 6 ? "end" : chapter)
        : null;
      const menuWasOpen = pausedAt !== null;
      showMenu(false, false);
      restart({ checkpoint });
      if (menuWasOpen) actions.playUiSound("menu");
    } catch (error) {
      console.warn("章节载入失败", error);
      showMenu(false);
      showNotice(t("chapterError"));
    }
  };
  function syncSoundtrack() {
    for (const guid of state.inPlay)
      if (!lastCardsInPlay.has(guid)) audioFocus = guid;
    lastCardsInPlay = new Set(state.inPlay);
    if (audioFocus && !state.inPlay.has(audioFocus)) audioFocus = undefined;
    const move = motion.navigation;
    const moving = move?.card === audioFocus && move?.plan.durationSeconds > 0;
    soundDirector?.syncLocation(
      moving ? move.destination : state.locations.get(audioFocus),
      moving ? move.plan.durationSeconds : audioFocus ? 0.01 : 1,
    );
    soundDirector?.syncScore(state, move);
  }
  function advanceStory(time) {
    const phase = nextStoryPhase(state, state.storyPhase);
    if (phase === state.storyPhase || (phase !== "ENDING" && inputBusy()))
      return;
    state.storyPhase = phase;
    state.version++;
    dirty = true;
    if (phase === "ENDING") endingStarted = motion.navigation?.started ?? time;
    if (phase === "CHAPTERS") {
      const guid = project.tree.attrs.staringCard,
        cell = state.coords.get(guid);
      if (cell) {
        motion.start("opening", { guid, cell }, time);
        state.coords.delete(guid);
      }
    } else if (phase === "EPILOGUE") {
      const cell = CELLS.find((point) => cardAt(state, point));
      const guid = cell && cardAt(state, cell);
      if (guid) {
        motion.start("closing", { guid, cell }, time);
        state.coords.delete(guid);
      }
    }
  }
  function paintEnding(time) {
    if (state.storyPhase !== "EPILOGUE" && state.storyPhase !== "ENDING")
      return;
    if (!creditsRequested) {
      creditsRequested = true;
      resources
        .loadCredits()
        .then((data) => {
          creditsData = data;
        })
        .catch((error) => console.warn("片尾名单载入失败", error));
    }
    if (endingScreen === undefined) {
      endingScreen = null;
      try {
        const screen = new EndingScreen(
          endingCanvas,
          manifest,
          project,
          document.baseURI,
        );
        if (screen.gl) {
          endingScreen = screen;
          screen.ready.catch((error) => {
            endingScreen = null;
            console.warn("结局画面载入失败", error);
          });
        }
      } catch (error) {
        console.warn("结局画面暂不可用", error);
      }
    }
    if (endingStarted === null) return;
    if (
      titleFadeStarted === null &&
      creditsPredicate &&
      state.isSatisfied(creditsPredicate) === true
    )
      titleFadeStarted = time;
    const fade =
      titleFadeStarted === null
        ? 1
        : Math.max(0, 1 - (time - titleFadeStarted) / 0.5);
    endingCanvas.hidden = !endingScreen?.loaded;
    endingScreen?.draw(time - endingStarted, fade);
    if (titleFadeStarted !== null && creditsData && !creditsScreen.data)
      creditsScreen.start(creditsData, titleFadeStarted);
    creditsScreen.update(time);
  }
  function paintGrid(ctx, progress, scale = 1, alpha = 1) {
    const lo = BOARD_INSET,
      hi = lo + 2 * CARD_SIZE,
      mid = lo + CARD_SIZE;
    ctx.save();
    if (scale !== 1) {
      ctx.translate(mid, mid);
      ctx.scale(scale, scale);
      ctx.translate(-mid, -mid);
    }
    ctx.globalAlpha = progress * alpha;
    ctx.fillStyle = "#f2f2f0";
    ctx.fillRect(lo, lo, hi - lo, hi - lo);
    ctx.strokeStyle = "#c8c8c8";
    ctx.strokeRect(lo + 0.5, lo + 0.5, hi - lo - 1, hi - lo - 1);
    ctx.globalAlpha = alpha;
    const fraction = (start) =>
      Math.max(0, Math.min(1, (progress - start) / (1 - start)));
    ctx.beginPath();
    ctx.moveTo(hi, mid + 0.5);
    ctx.lineTo(hi - (hi - lo) * fraction(0.375), mid + 0.5);
    ctx.moveTo(mid + 0.5, lo);
    ctx.lineTo(mid + 0.5, lo + (hi - lo) * fraction(0.125));
    ctx.stroke();
    ctx.restore();
  }
  function scheduleFrame() {
    if (
      disposed ||
      backgrounded ||
      ui.loadFailed ||
      frameRequest !== null ||
      frameRunning
    )
      return;
    frameRequest = requestAnimationFrame(frame);
  }
  function resizeBoard() {
    const nextDensity = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (!resizePending && density === nextDensity) return;
    density = nextDensity;
    resizePending = false;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const pixels = Math.min(
      BOARD_SIZE * 2,
      Math.max(1, Math.round(Math.min(width, height) * density)),
    );
    if (boardFrame.width === pixels && boardFrame.height === pixels) return;
    boardFrame.width = boardFrame.height = pixels;
    rasterScale = pixels / BOARD_SIZE;
    dirty = true;
  }
  async function frame() {
    frameRequest = null;
    if (disposed || backgrounded) return;
    frameRunning = true;
    try {
      resizeBoard();
      await drawFrame();
    } finally {
      frameRunning = false;
      scheduleFrame();
    }
  }
  async function drawFrame() {
    if (startup.active) {
      startup.update(pageNow() / 1000, bootReady && !ui.loading);
      if (!startup.active) {
        epoch = pageNow();
        ui.startupActive = false;
        if (startup.audioRequested && !settings.soundMuted) setSound(true);
      } else if (!bootReady || !startup.showingLast) {
        return;
      }
    }
    if (!bootReady) return;
    if (pausedAt !== null) return;
    try {
      const time = now();
      if (motion.update(time)) dirty = true;
      const viewpoint = motion.navigation?.sample.viewpoint;
      if (scripts.update(state, time, { displayCoords })) dirty = true;
      if (state.version !== lastStateVersion) {
        dirty = true;
        lastStateVersion = state.version;
      }
      followCapturedTransitions();
      const linkChanges = links.refresh();
      const changes = state.step();
      if (changes.length || linkChanges.changed) dirty = true;
      if (changes.length) links.refresh();
      unlockChapters();
      updateMargin();
      advanceStory(time);
      if (!inputBusy()) {
        for (const card of cards()) {
          const auto = state
            .getTransitions(card.guid)
            .find((t) => t.attrs.hotspotStyle === "NONE");
          if (auto) {
            navigate(card, auto);
            break;
          }
        }
      }
      syncSoundtrack();
      const buildReport = (card) => ({
        card,
        report: renderer.buildDrawList(card.location, {
          timeSeconds: time,
          graphicTimes,
          transitionLocations:
            motion.navigation?.card === card.guid
              ? motion.navigation.plan.locations
              : undefined,
          viewpoint:
            motion.navigation?.card === card.guid ? viewpoint : undefined,
        }),
      });
      let reports = cards().map(buildReport);
      let newClock = false;
      const active = new Set();
      for (const { report } of reports)
        for (const animation of report.animations) {
          active.add(animation.guid);
          if (!graphicTimes.has(animation.guid)) {
            graphicTimes.set(animation.guid, time);
            soundDirector?.playGraphic(
              project.get(animation.guid),
              state,
              motion.navigation,
            );
            newClock = true;
          }
        }
      for (const guid of graphicTimes.keys())
        if (!active.has(guid)) graphicTimes.delete(guid);
      if (newClock) reports = reports.map(({ card }) => buildReport(card));
      const hasAnimations = reports.some(({ report }) =>
        report.animations.some((a) => !a.complete),
      );
      blockedCards = new Set();
      for (const { card, report } of reports)
        if (
          report.animations.some(
            (a) =>
              !a.complete &&
              project.get(a.guid)?.attrs.interactiveWhenAnimating !== "true" &&
              project.owner(project.get(a.guid), "Card")?.attrs.guid ===
                card.guid,
          )
        )
          blockedCards.add(card.guid);
      updateBoardCursor();
      // A layer that no longer has an enabled graphic must stop gating state transitions.
      // Combine all reports: a linked or stacked view can show the same layer as another card.
      layerStatus.clear();
      const record = (guid, complete) => {
        if (!guid) return;
        const previous = layerStatus.get(guid)?.complete;
        layerStatus.set(guid, {
          state: state.states.get(guid),
          complete:
            complete === false || previous === false
              ? false
              : complete === null || previous === null
                ? null
                : true,
        });
      };
      for (const { report } of reports) {
        for (const animation of report.animations)
          record(animation.sceneLayerGUID, animation.complete);
        for (const item of report.unsupported) {
          if (
            [
              "PlayListGraphic",
              "MotionKeyframesGraphic",
              "SpriteSequenceGraphic",
            ].includes(item.type) &&
            /时长|动画|关键帧|逐帧/.test(item.reason)
          ) {
            record(
              project.owner(project.get(item.guid), "LocationLayer")?.attrs
                .sceneLayer,
              null,
            );
          }
        }
      }
      if (dirty || hasAnimations || motion.navigation || newClock) {
        dirty = false;
        const frameState = state;
        // Decoding a card can yield to the browser. Keep the last finished board visible until every card is painted.
        frameContext.setTransform(1, 0, 0, 1, 0, 0);
        frameContext.clearRect(0, 0, boardFrame.width, boardFrame.height);
        frameContext.scale(rasterScale, rasterScale);
        if (showGrid())
          paintGrid(
            frameContext,
            motion.opening?.sample.progress ?? 1,
            motion.closing?.sample.scale,
            motion.closing?.sample.alpha,
          );
        const activeTextureUrls = reportTextureUrls(
          reports.map((entry) => entry.report),
        );
        waitingForBoardTextures = [...activeTextureUrls].some(
          (url) => !renderer.atlas.images.has(url),
        );
        updateBoardCursor();
        const sceneLoads = ui.loading
          ? new Map(
              [...activeTextureUrls]
                .filter(
                  (url) =>
                    renderer.atlas.images.has(url) &&
                    !renderer.atlas.pending.has(url),
                )
                .map((url) => [url, true]),
            )
          : null;
        const onTextureLoaded = sceneLoads
          ? (url, loaded) => {
              if (state !== frameState) return;
              sceneLoads.set(url, loaded);
              const completed = [...sceneLoads.values()].filter(Boolean).length;
              updateStartupProgress(
                "loadingScene",
                completed,
                activeTextureUrls.length,
                sceneLoads.size - completed,
              );
            }
          : undefined;
        if (sceneLoads)
          updateStartupProgress(
            "loadingScene",
            sceneLoads.size,
            activeTextureUrls.length,
          );
        const entries = reports.map(({ card, report }) => ({
          card,
          report,
          position: placement(card),
        }));
        for (const {
          card,
          report,
          position: [x, y],
        } of entries) {
          frameContext.save();
          frameContext.translate(x, y);
          frameContext.fillStyle = "#f2f2f0";
          frameContext.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
          try {
            await renderer.render(frameContext, card.location, {
              activeTextureUrls,
              rasterScale,
              report,
              onTextureLoaded,
            });
          } finally {
            frameContext.restore();
          }
        }
        waitingForBoardTextures = false;
        if (
          disposed ||
          backgrounded ||
          pausedAt !== null ||
          state !== frameState
        ) {
          dirty = true;
          return;
        }
        if (
          canvas.width !== boardFrame.width ||
          canvas.height !== boardFrame.height
        )
          canvas.width = canvas.height = boardFrame.width;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(boardFrame, 0, 0);
        updateBoardCursor();
        if (ui.loading) reportStartup();
        ui.loading = false;
      }
      canvas.dataset.locations = cards()
        .map((card) => card.location)
        .join("|");
      canvas.dataset.phase = state.storyPhase;
      paintEnding(time);
      ui.phase = state.storyPhase;
      updateButtons();
      if (
        saveStorage &&
        !inputBusy() &&
        !hasAnimations &&
        state.version !== lastSavedVersion
      ) {
        if (writeSave(saveStorage, SAVE_KEY, state))
          lastSavedVersion = state.version;
      }
    } catch (error) {
      waitingForBoardTextures = false;
      updateBoardCursor();
      console.error(error);
      showNotice(t("renderError"));
      ui.loading = false;
    }
  }
  listen(startupButton, "click", () => {
    if (backgrounded || disposed) return;
    if (
      !settings.soundMuted &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    ) {
      unlockBank(interfaceBank).catch((error) =>
        console.warn("界面声音暂未解锁", error),
      );
      startup.enableMusic();
    }
  });
  listen(board, "pointerdown", () => {
    if (
      !backgrounded &&
      !disposed &&
      !settings.soundMuted &&
      !soundDirector &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    )
      setSound(true);
  });
  function setBackground(hidden) {
    if (disposed || hidden === backgrounded) return;
    backgrounded = hidden;
    if (hidden) {
      hiddenAt = performance.now();
      uiSoundGeneration++;
      cancelPointer();
      interfaceSounds.stop();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null;
    } else {
      hiddenDuration += performance.now() - hiddenAt;
      hiddenAt = null;
      resizePending = true;
      dirty = true;
      scheduleFrame();
    }
    updateAudioPause().catch((error) =>
      console.warn("后台音频状态更新失败", error),
    );
  }
  listen(document, "visibilitychange", () =>
    setBackground(document.hidden || pageHidden),
  );
  listen(window, "pagehide", () => {
    pageHidden = true;
    setBackground(true);
  });
  listen(window, "pageshow", () => {
    pageHidden = false;
    setBackground(document.hidden);
  });
  const onResize = () => {
    resizePending = true;
    dirty = true;
    scheduleFrame();
  };
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas);
  listen(window, "resize", onResize);
  actions.disposeGame = () => {
    if (disposed) return;
    disposed = true;
    ui.startupProgress = [];
    cancelPointer();
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
    for (const remove of listeners) remove();
    resizeObserver.disconnect();
    startup.finish();
    motion.cancel();
    creditsScreen?.reset();
    soundDirector?.stop();
    soundBank.stopAll();
    actions.disposeInterfaceSounds();
    soundBank.context
      ?.close()
      .catch((error) => console.warn("游戏音频关闭失败", error));
  };
  scheduleFrame();
  try {
    let dataCompleted = 0;
    const dataRequests = [
      loadProject(),
      read("assets/manifest.json"),
      read("assets/data/atlases.json"),
    ];
    const [{ project: loaded }, loadedManifest, atlases] = await Promise.all(
      dataRequests.map(async (request) => {
        const result = await request;
        updateStartupProgress(
          "loadingData",
          ++dataCompleted,
          dataRequests.length,
        );
        return result;
      }),
    );
    if (disposed) return;
    markStartup("data-loaded");
    project = loaded;
    manifest = loadedManifest;
    textureUrls = createTextureUrls(manifest, document.baseURI);
    ui.textures = textureUrls;
    renderer = new SceneRenderer(project, manifest, atlases, {
      baseUrl: document.baseURI,
      holeContent: (node) => resolveHoleContent(project, state, node),
      scriptGraphics: (graphic, matrix, options) =>
        scripts.graphics(graphic, matrix, options),
      scriptDurationMillis: (graphic) => scripts.durationMillis(graphic),
    });
    restart({ restoreSaved: true });
    markStartup("state-restored");
    document.body.style.setProperty(
      "--paper",
      cssImage(textureUrl("PaperTex1_tile")),
    );
    for (const name of UI_STYLE_TEXTURES) {
      document.body.style.setProperty(
        `--${name.toLowerCase().replaceAll("_", "-")}`,
        cssImage(textureUrl(name)),
      );
    }
    const milestones = project
      .all("Milestone")
      .filter(
        (node) =>
          project.owner(node, "MilestoneSequence")?.attrs.id === "chapters",
      );
    chapterMilestones = [
      "chapter1",
      "chapter2",
      "chapter3",
      "chapter4",
      "chapter5",
      "end",
    ].map(
      (id) =>
        project.container(
          milestones.find((node) => node.attrs.id === id),
          "predicate",
        )[0],
    );
    margins = project
      .container(project.tree, "marginGraphics", "MarginGraphics")
      .map((definition) => ({
        attrs: definition.attrs,
        predicate: project.container(definition, "predicate")[0],
      }));
    const credits = milestones.find((node) => node.attrs.id === "credits");
    creditsPredicate = project.container(credits, "predicate")[0];
    creditsScreen = new EndingCredits(
      ...["credits", "credits-page", "credits-prev", "credits-next"].map((id) =>
        document.getElementById(id),
      ),
      {
        previous: textureUrl("credits_back"),
        next: textureUrl("credits_forward"),
      },
    );
    bootReady = true;
    ui.ready = true;
  } catch (error) {
    startup.finish();
    ui.startupActive = false;
    ui.loadFailed = true;
    console.error(error);
    showNotice(t("loadError"));
  }

  // 用户手势启用原版声音，同时核对实际浏览器解码结果；不把容器识别当作可播放。

  async function unlockBank(bank) {
    await bank.resume();
    if (disposed) {
      if (bank.context.state !== "closed") await bank.context.close();
    } else if (backgrounded) await bank.context.suspend();
  }
  async function syncAudioBank(bank, shouldPause, director) {
    if (!bank.context || bank.context.state === "closed" || disposed) return;
    let pause;
    do {
      pause = shouldPause();
      if (pause) {
        if (director) await director.suspend();
        else await bank.context.suspend();
      } else if (bank.context.state !== "running") {
        await bank.resume();
        if (disposed && bank.context.state !== "closed")
          await bank.context.close();
      }
    } while (
      !disposed &&
      bank.context.state !== "closed" &&
      pause !== shouldPause()
    );
  }
  async function updateAudioPause() {
    await Promise.all([
      syncAudioBank(
        soundBank,
        () => backgrounded || settings.soundMuted || pausedAt !== null,
        soundDirector,
      ),
      syncAudioBank(interfaceBank, () => backgrounded || settings.soundMuted),
    ]);
    if (
      soundDirector &&
      !disposed &&
      !backgrounded &&
      !settings.soundMuted &&
      pausedAt === null
    )
      syncSoundtrack();
  }

  async function setSound(enabled, remember = false) {
    if (!bootReady || ui.soundBusy || interfaceSounds.disposed) return;
    ui.soundBusy = true;
    const previousMuted = settings.soundMuted;
    try {
      if (enabled) {
        // 两个上下文都在用户手势内发起解锁，必须早于任何网络请求。
        await Promise.all([unlockBank(soundBank), unlockBank(interfaceBank)]);
        if (interfaceSounds.disposed) return;
        if (!soundDirector) {
          const { events } = await read("assets/audio/events.json");
          if (interfaceSounds.disposed) return;
          soundDirector = new SoundtrackDirector(project, events, soundBank);
        }
      }
      settings.soundMuted = !enabled;
      interfaceSounds.setEnabled(enabled);
      await updateAudioPause();
      if (interfaceSounds.disposed) return;
      if (remember) preferences.rememberSound();
      ui.soundLabel =
        soundDirector && !settings.soundMuted ? "soundOff" : "soundOn";
    } catch (error) {
      settings.soundMuted = previousMuted;
      interfaceSounds.setEnabled(!previousMuted && Boolean(soundDirector));
      ui.soundLabel = "retrySound";
      console.warn("声音暂未就绪", error);
    } finally {
      ui.soundBusy = false;
    }
  }
  actions.toggleSound = () =>
    setSound(!soundDirector || settings.soundMuted, true);
}
