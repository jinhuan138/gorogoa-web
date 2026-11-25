import { GameMotion } from "./motion.js";
import { createBoardPresentation } from "./boardPresentation.js";
import { createBoardInput } from "./boardInput.js";
import { createGameAudio } from "./gameAudio.js";
import {
  planTransition,
  sampleTransition,
  hotspotRegion,
} from "../engine/model/navigation.js";
import { SAVE_KEY, readSave, writeSave } from "../engine/model/storage.js";
import { resolveHoleContent } from "../engine/model/holes.js";
import { LinkModel } from "../engine/model/links.js";
import {
  BOARD_SIZE,
  CELLS,
  centerCard,
  cellPosition,
  cardAt,
  currentStoryPhase,
  nextStoryPhase,
  finishCardDrop,
} from "../engine/model/board.js";
import { loadChapterCheckpoint, loadProject } from "../engine/model/project.js";
import { SceneRenderer, reportTextureUrls } from "../engine/render/renderer.js";
import { RuntimeState } from "../engine/model/state.js";
import { ProjectScripts } from "../engine/model/scripts.js";
import { createEndingFlow } from "./screens/endingFlow.js";
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
  const board = document.getElementById("board");
  const boardPresentation = createBoardPresentation(canvas);
  const staticCardReports = new Map();
  const endingFlow = createEndingFlow(
    document.getElementById("ending"),
    resources.loadCredits,
  );
  const pauseButton = document.getElementById("pause");
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
  const listeners = [];
  const pageNow = () => (hiddenAt ?? performance.now()) - hiddenDuration;
  function listen(target, type, callback) {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  }
  const audio = createGameAudio({
    ui,
    settings,
    preferences,
    actions,
    baseUrl: document.baseURI,
    read: resources.read,
    pageNow,
    isBackgrounded: () => backgrounded,
    isDisposed: () => disposed,
    isBootReady: () => bootReady,
    getProject: () => project,
    getState: () => state,
    getMove: () => motion.navigation,
  });
  const startupButton = document.getElementById("startup");
  const gameShell = document.getElementById("game-shell");
  const startup = new StartupScreen(
    startupButton,
    audio.soundBank,
    document.baseURI,
    () => t("gameName"),
    {
      now: () => pageNow() / 1000,
      isPaused: () => backgrounded || disposed,
      onProgress: (completed, total, failed) =>
        updateStartupProgress("loadingLogos", completed, total, failed),
      resume: audio.resumeStartup,
    },
  );
  let bootReady = false;
  const read = resources.read;
  const saveStorage = preferences.storage;
  let lastSavedVersion = -1;
  let chapterMilestones = [];
  let margins = [];
  let activeMargin = null;
  let gameClockPausedAt = null;
  let waitingForBoardTextures = false;
  let texturePreparation = null;
  const textureFailures = new Map();
  let project,
    state,
    links,
    scripts,
    renderer,
    epoch = pageNow(),
    dirty = true,
    lastHotspotKey = "",
    lastStateVersion = -1;
  let blockedCards = new Set();
  let textureUrls = new Map();
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
  const gameClockTime = () => gameClockPausedAt ?? pageNow();
  const now = () => (startup.active ? 0 : (gameClockTime() - epoch) / 1000);
  function updateGameClockPause() {
    if (ui.paused || (waitingForBoardTextures && !texturePreparation?.ready)) {
      gameClockPausedAt ??= pageNow();
    } else if (gameClockPausedAt !== null) {
      epoch += pageNow() - gameClockPausedAt;
      gameClockPausedAt = null;
    }
  }
  const motion = new GameMotion({
    navigation: (move) => state.setLocation(move.card, move.destination),
    flight: ({ drag: drop, plan }) => {
      const lowerCard = cardAt(state, plan.cell);
      if (finishCardDrop(links, drop, plan)) {
        if (
          state.captors.get(lowerCard) === drop.draggedGUID &&
          state.captureSides.get(lowerCard) === "UNDER"
        )
          audio.focusCard(drop.draggedGUID);
        audio.playInterface("int_drop_card");
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
  const inputBusy = (allowPreparedTextures = false) =>
    disposed ||
    backgrounded ||
    startup.active ||
    ui.paused ||
    (waitingForBoardTextures &&
      !(allowPreparedTextures && texturePreparation?.ready)) ||
    Boolean(boardInput.drag || motion.busy);
  const canMove = (guid) => !blockedCards.has(guid);
  function cards() {
    const front =
      boardInput.drag?.draggedGUID ||
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
    const { drag } = boardInput;
    if (drag?.draggedGUID === card.guid) return drag.topLeft;
    return (
      motion.position(card.guid) ??
      (showGrid() ? cellPosition(card.coords) : centerCard())
    );
  }
  function displayCoords(guid) {
    return (
      motion.displayCoords(guid, boardInput.drag) ?? state.coords.get(guid)
    );
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
      textureFailures.clear();
      prefetchPlan(plan);
      state.targets.set(card.guid, transition.attrs.guid);
      staticCardReports.clear();
      if (plan.durationSeconds > 0) audio.focusCard(card.guid);
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
  function setBoardTextureWait(waiting) {
    waitingForBoardTextures = waiting;
    updateGameClockPause();
  }
  const boardInput = createBoardInput({
    canvas,
    board,
    listen,
    getState: () => state,
    getLinks: () => links,
    cards,
    placement,
    showGrid,
    inputBusy,
    canMove,
    isBackgrounded: () => backgrounded,
    isDisposed: () => disposed,
    isWaitingForTextures: () => waitingForBoardTextures,
    isMotionBusy: () => motion.busy,
    showHints: () => settings.showHints,
    activeTransitions,
    invalidate() {
      dirty = true;
      staticCardReports.clear();
    },
    markDirty() {
      dirty = true;
    },
    onReveal: audio.focusRevealedCard,
    onLift: () => audio.playInterface("int_lift_card"),
    playHint: audio.playHint,
    onDrop: (drag, plan) => motion.start("flight", { drag, plan }, now()),
  });
  const { cancelPointer, flushTouchMove, updateBoardCursor } = boardInput;
  function restart({ restoreSaved = false, checkpoint = null } = {}) {
    if (!project) return;
    texturePreparation = null;
    textureFailures.clear();
    setBoardTextureWait(false);
    boardPresentation.invalidateBackdrop();
    audio.stopForRestart();
    epoch = gameClockTime();
    graphicTimes.clear();
    staticCardReports.clear();
    layerStatus.clear();
    blockedCards.clear();
    motion.cancel();
    boardInput.reset();
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
    endingFlow.reset(state.storyPhase);
    lastSavedVersion = -1;
    links = new LinkModel(project, state);
    links.refresh();
    audio.resetFocus();
    renderer.isSatisfied = (node) => state.isSatisfied(node);
    dirty = true;
    lastHotspotKey = null;
    showNotice("");
  }
  function textureUrl(name) {
    return textureUrls.get(name);
  }
  function showMenu(open, feedback = true) {
    if (disposed || startup.active || !state || open === ui.paused) return;
    if (open) {
      cancelPointer();
      actions.resetMenu();
    }
    ui.paused = open;
    updateGameClockPause();
    if (feedback) actions.playUiSound("menu");
    audio
      .updatePause()
      .catch((error) => console.warn("声音暂停状态更新失败", error));
    updateButtons();
    pauseButton.focus();
  }
  actions.toggleMenu = () => showMenu(!ui.paused);
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
      const menuWasOpen = ui.paused;
      showMenu(false, false);
      restart({ checkpoint });
      if (menuWasOpen) actions.playUiSound("menu");
    } catch (error) {
      console.warn("章节载入失败", error);
      showMenu(false);
      showNotice(t("chapterError"));
    }
  };
  function advanceStory(time) {
    const phase = nextStoryPhase(state, state.storyPhase);
    if (phase === state.storyPhase || (phase !== "ENDING" && inputBusy()))
      return;
    state.storyPhase = phase;
    state.version++;
    dirty = true;
    if (phase === "ENDING")
      endingFlow.start(motion.navigation?.started ?? time);
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
  async function prepareBoardTextures(urls) {
    const preparation = { ready: false };
    texturePreparation = preparation;
    // 保留与上一帧画面对应的光标和热点；等待期间 inputBusy 仍拦截新操作。
    setBoardTextureWait(true);
    const ready = renderer.atlas.prepare(urls).then(({ failures }) => {
      if (preparation !== texturePreparation) return;
      for (const [url, reason] of failures) textureFailures.set(url, reason);
      preparation.ready = true;
      updateGameClockPause();
    });
    // 已在本轮完成的解码可以直接显示本帧，耗时的解码不占用后续帧。
    let timer;
    await Promise.race([
      ready,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 0);
      }),
    ]);
    clearTimeout(timer);
    if (preparation !== texturePreparation) return false;
    if (preparation.ready) return true;
    ready.then(() => {
      if (preparation !== texturePreparation) return;
      dirty = true;
      scheduleFrame();
    });
    return false;
  }
  async function frame() {
    frameRequest = null;
    if (disposed || backgrounded) return;
    frameRunning = true;
    try {
      if (boardPresentation.resize()) dirty = true;
      flushTouchMove();
      await drawFrame();
    } finally {
      if (!texturePreparation && waitingForBoardTextures) {
        setBoardTextureWait(false);
        updateBoardCursor();
      }
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
        if (startup.audioRequested && !settings.soundMuted) audio.enable();
      } else if (!bootReady || !startup.showingLast) {
        return;
      }
    }
    if (!bootReady) return;
    if (ui.paused) return;
    if (texturePreparation && !texturePreparation.ready) {
      const { drag } = boardInput;
      if (drag)
        boardPresentation.moveDraggedCard(drag.draggedGUID, drag.topLeft);
      return;
    }
    try {
      const time = now();
      if (motion.update(time)) dirty = true;
      const viewpoint = motion.navigation?.sample.viewpoint;
      if (scripts.update(state, time, { displayCoords })) {
        dirty = true;
        staticCardReports.clear();
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
      audio.syncSoundtrack();
      if (state.version !== lastStateVersion) {
        dirty = true;
        lastStateVersion = state.version;
        staticCardReports.clear();
      }
      if (textureFailures.size) staticCardReports.clear();
      const navigatingCard = motion.navigation?.card;
      const buildReport = (card) =>
        renderer.buildDrawList(card.location, {
          timeSeconds: time,
          graphicTimes,
          transitionLocations:
            navigatingCard === card.guid
              ? motion.navigation.plan.locations
              : undefined,
          viewpoint: navigatingCard === card.guid ? viewpoint : undefined,
        });
      let reports = cards().map((card) => ({
        card,
        report: staticCardReports.get(card.guid) ?? buildReport(card),
      }));
      let newClock = false;
      const active = new Set();
      for (const { report } of reports)
        for (const animation of report.animations) {
          active.add(animation.guid);
          if (!graphicTimes.has(animation.guid)) {
            graphicTimes.set(animation.guid, time);
            audio.playGraphic(animation.guid);
            newClock = true;
          }
        }
      for (const guid of graphicTimes.keys())
        if (!active.has(guid)) graphicTimes.delete(guid);
      if (newClock)
        reports = reports.map(({ card }) => ({
          card,
          report: buildReport(card),
        }));
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
      for (const { card, report } of reports) {
        // 已完成的图形保持在终帧。镜头过渡和仍在播放的图形须重新采样。
        if (
          card.guid !== navigatingCard &&
          report.animations.every((animation) => animation.complete)
        )
          staticCardReports.set(card.guid, report);
        else staticCardReports.delete(card.guid);
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
        const activeTextureUrls = reportTextureUrls(
          reports.map((entry) => entry.report),
        );
        renderer.atlas.retainActive(activeTextureUrls);
        for (const url of textureFailures.keys())
          if (
            !renderer.atlas.active.has(url) ||
            renderer.atlas.decoded.has(url)
          )
            textureFailures.delete(url);
        const missing = activeTextureUrls.filter(
          (url) =>
            !renderer.atlas.decoded.has(url) && !textureFailures.has(url),
        );
        if (ui.loading) {
          let completed =
            activeTextureUrls.length - missing.length - textureFailures.size;
          let failed = textureFailures.size;
          const progress = () =>
            updateStartupProgress(
              "loadingScene",
              completed,
              activeTextureUrls.length,
              failed,
            );
          progress();
          if (missing.length) {
            setBoardTextureWait(true);
            const { failures } = await renderer.atlas.prepare(
              missing,
              (_, loaded) => {
                if (state !== frameState) return;
                if (loaded) completed++;
                else failed++;
                progress();
              },
            );
            if (state === frameState && !disposed)
              for (const [url, reason] of failures)
                textureFailures.set(url, reason);
          }
        } else if (missing.length) {
          if (!(await prepareBoardTextures(missing))) return;
        }
        const entries = reports.map(({ card, report }) => ({
          card,
          report,
          position: placement(card),
        }));
        const grid = showGrid()
          ? [
              motion.opening?.sample.progress ?? 1,
              motion.closing?.sample.scale,
              motion.closing?.sample.alpha,
            ]
          : null;
        if (
          !(await boardPresentation.present(entries, {
            renderer,
            textureFailures,
            layered: frameState.storyPhase === "CHAPTERS" && !ui.loading,
            grid,
            canPresent: () =>
              !disposed && !backgrounded && !ui.paused && state === frameState,
          }))
        ) {
          dirty = true;
          return;
        }
        texturePreparation = null;
        setBoardTextureWait(false);
        if (ui.loading) {
          reportStartup();
          ui.loading = false;
          if (showGrid()) dirty = true;
        }
      }
      canvas.dataset.locations = cards()
        .map((card) => card.location)
        .join("|");
      canvas.dataset.phase = state.storyPhase;
      endingFlow.update(time, state);
      ui.phase = state.storyPhase;
      updateBoardCursor();
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
      texturePreparation = null;
      setBoardTextureWait(false);
      updateBoardCursor();
      console.error(error);
      showNotice(t("renderError"));
      ui.loading = false;
    }
  }
  listen(startupButton, "click", () =>
    audio.enableStartupAudio(() => startup.enableMusic()),
  );
  listen(board, "pointerdown", audio.enableBoardAudio);
  function setBackground(hidden) {
    if (disposed || hidden === backgrounded) return;
    backgrounded = hidden;
    if (hidden) {
      hiddenAt = performance.now();
      audio.enterBackground();
      cancelPointer();
      audio.stopInterface();
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null;
    } else {
      hiddenDuration += performance.now() - hiddenAt;
      hiddenAt = null;
      boardPresentation.requestResize();
      dirty = true;
      scheduleFrame();
    }
    audio
      .updatePause()
      .catch((error) => console.warn("后台音频状态更新失败", error));
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
    boardPresentation.requestResize();
    dirty = true;
    scheduleFrame();
  };
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas);
  listen(window, "resize", onResize);
  actions.disposeGame = () => {
    if (disposed) return;
    disposed = true;
    texturePreparation = null;
    textureFailures.clear();
    staticCardReports.clear();
    boardPresentation.dispose();
    ui.startupProgress = [];
    cancelPointer();
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
    for (const remove of listeners) remove();
    resizeObserver.disconnect();
    startup.finish();
    motion.cancel();
    endingFlow.dispose();
    audio.dispose();
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
    textureUrls = createTextureUrls(loadedManifest, document.baseURI);
    ui.textures = textureUrls;
    renderer = new SceneRenderer(project, loadedManifest, atlases, {
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
    endingFlow.configure({
      project,
      manifest: loadedManifest,
      predicate: project.container(credits, "predicate")[0],
      textureUrl,
    });
    bootReady = true;
    ui.ready = true;
  } catch (error) {
    startup.finish();
    ui.startupActive = false;
    ui.loadFailed = true;
    console.error(error);
    showNotice(t("loadError"));
  }
}
