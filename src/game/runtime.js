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
  currentStoryPhase,
  nextStoryPhase,
  chapterOpening,
  chapterClosing,
  beginCardDrag,
  cancelCardDrag,
  planCardDrop,
  sampleCardDrop,
  finishCardDrop,
} from "../engine/model/board.js";
import { loadChapterCheckpoint, loadProject } from "../engine/model/project.js";
import { SceneRenderer, reportTextureUrls } from "../engine/render/renderer.js";
import { RuntimeState } from "../engine/model/state.js";
import { ProjectScripts } from "../engine/model/scripts.js";
import { EndingScreen } from "./screens/ending.js";
import { EndingCredits } from "./screens/credits.js";
import { StartupScreen } from "./screens/startup.js";
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
  boardFrame.width = boardFrame.height = BOARD_SIZE * 2;
  const frameContext = boardFrame.getContext("2d");
  const board = document.getElementById("board");
  const endingCanvas = document.getElementById("ending");
  const pauseButton = document.getElementById("pause");
  const soundBank = new AudioBank({ baseUrl: document.baseURI });
  const interfaceBank = new AudioBank({ baseUrl: document.baseURI });
  const interfaceSounds = new InterfaceSounds(interfaceBank);
  actions.playUiSound = async (name) => {
    if (settings.soundMuted || interfaceSounds.disposed) return;
    if (!soundDirector) {
      if (!(globalThis.AudioContext || globalThis.webkitAudioContext)) return;
      const snapshot = state;
      await setSound(true);
      if (state !== snapshot) return;
    }
    return interfaceSounds.play(name);
  };
  actions.disposeInterfaceSounds = () =>
    interfaceSounds
      .dispose()
      .catch((error) => console.warn("界面音频关闭失败", error));
  const startupButton = document.getElementById("startup");
  const gameShell = document.getElementById("game-shell");
  const startup = new StartupScreen(startupButton, soundBank, document.baseURI);
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
    interfaceSounds.adjustVolume(channel, volume, performance.now() / 1000);
  };
  let project,
    state,
    links,
    scripts,
    renderer,
    manifest,
    epoch = performance.now(),
    viewChange = null,
    dirty = true,
    drag = null,
    press = null,
    tap = null,
    opening = null,
    closing = null,
    flight = null,
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
    startup.active ? 0 : ((pausedAt ?? performance.now()) - epoch) / 1000;
  const showNotice = (message) => {
    ui.notice = message;
  };
  const showGrid = () => state.storyPhase === "CHAPTERS" || Boolean(closing);
  const inputBusy = () =>
    startup.active ||
    pausedAt !== null ||
    Boolean(viewChange || drag || flight || opening || closing);
  const canMove = (guid) => !blockedCards.has(guid);
  function cards() {
    const front =
      drag?.draggedGUID || flight?.drag.draggedGUID || closing?.guid;
    return [...state.inPlay]
      .filter(
        (guid) =>
          guid === front || guid === opening?.guid || state.coords.has(guid),
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
    if (flight?.drag.draggedGUID === card.guid) return flight.sample.dragged;
    if (flight?.plan.shuffle?.guid === card.guid) return flight.sample.shuffled;
    if (opening?.guid === card.guid) return opening.sample.position;
    if (closing?.guid === card.guid) return closing.sample.position;
    return showGrid() ? cellPosition(card.coords) : centerCard();
  }
  function displayCoords(guid) {
    let pixels;
    if (drag?.draggedGUID === guid) pixels = drag.topLeft;
    else if (flight?.drag.draggedGUID === guid) pixels = flight.sample.dragged;
    else if (flight?.plan.shuffle?.guid === guid)
      pixels = flight.sample.shuffled;
    else if (opening?.guid === guid) pixels = opening.sample.position;
    return pixels
      ? pixels.map((value) => (value - BOARD_INSET) / CARD_SIZE)
      : state.coords.get(guid);
  }
  function logicalPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * BOARD_SIZE,
      ((event.clientY - rect.top) / rect.height) * BOARD_SIZE,
    ];
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
  function navigate(card, transition) {
    if (inputBusy()) return;
    if (transition.attrs.hotspotStyle !== "NONE" && !canMove(card.guid)) return;
    if (!state.getTransitions(card.guid).includes(transition)) return;
    try {
      const plan = planTransition(project, transition);
      state.targets.set(card.guid, transition.attrs.guid);
      if (plan.durationSeconds > 0) audioFocus = card.guid;
      viewChange = {
        card: card.guid,
        destination: plan.destination.attrs.guid,
        plan,
        started: now(),
      };
      board.dataset.cursor = "wait";
      dirty = true;
      showNotice("");
    } catch (error) {
      showNotice(t("transitionError"));
      console.warn(error);
    }
  }
  function followCapturedTransitions() {
    if (!viewChange) return;
    const target = state.targets.get(viewChange.card);
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
    if (!state) return;
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
      waitingForBoardTextures ||
      viewChange ||
      flight ||
      opening ||
      closing ||
      (hovered && !canMove(hovered));
    const canDrag = hovered && state.coords.has(hovered) && showGrid();
    board.dataset.cursor = drag
      ? "move"
      : waiting
        ? "wait"
        : canDrag
          ? "hand"
          : "default";
  }
  board.addEventListener("pointerdown", (event) => {
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
  board.addEventListener("pointermove", (event) => {
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
  board.addEventListener("pointerleave", (event) => {
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
      state === snapshot && pausedAt === null && settings.showHints;
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
  board.addEventListener("pointerup", (event) => {
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
    if (plan)
      flight = {
        drag: current,
        plan,
        started: now(),
        sample: sampleCardDrop(plan, 0),
      };
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
  board.addEventListener("pointercancel", abandonPointer);
  board.addEventListener("lostpointercapture", (event) => {
    // 触摸的隐式捕获从子元素转交棋盘时，子元素的失去捕获事件也会冒泡。
    if (event.target === board) abandonPointer(event);
  });
  function restart({ restoreSaved = false, checkpoint = null } = {}) {
    if (!project) return;
    soundDirector?.stop();
    interfaceSounds.stop();
    epoch = performance.now();
    graphicTimes.clear();
    layerStatus.clear();
    blockedCards.clear();
    viewChange = drag = press = tap = opening = closing = flight = null;
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
    if (startup.active || !state || open === (pausedAt !== null)) return;
    if (open) {
      if (drag) {
        cancelCardDrag(links, drag);
        drag = null;
        dirty = true;
      }
      press = tap = null;
      pausedAt = performance.now();
      actions.resetMenu();
    } else {
      epoch += performance.now() - pausedAt;
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
    const moving =
      viewChange &&
      viewChange.card === audioFocus &&
      viewChange.plan.durationSeconds > 0;
    const location = moving
      ? viewChange.destination
      : state.locations.get(audioFocus);
    soundDirector?.syncLocation(
      location,
      moving ? viewChange.plan.durationSeconds : audioFocus ? 0.01 : 1,
    );
    soundDirector?.syncScore(state, viewChange);
  }
  function navigationView(time) {
    if (!viewChange) return null;
    const move = viewChange,
      sample = sampleTransition(move.plan, time - move.started);
    if (sample.complete) {
      state.setLocation(move.card, move.destination);
      viewChange = null;
      dirty = true;
      return null;
    }
    return sample.viewpoint;
  }
  function updateBoardMotion(time) {
    if (flight) {
      flight.sample = sampleCardDrop(flight.plan, time - flight.started);
      dirty = true;
      if (flight.sample.complete) {
        const { drag: drop, plan } = flight;
        const lowerCard = [...state.coords].find(
          ([, point]) => point[0] === plan.cell[0] && point[1] === plan.cell[1],
        )?.[0];
        if (finishCardDrop(links, drop, plan)) {
          if (
            state.captors.get(lowerCard) === drop.draggedGUID &&
            state.captureSides.get(lowerCard) === "UNDER"
          )
            audioFocus = drop.draggedGUID;
          soundDirector?.playInterface("int_drop_card");
        }
        flight = null;
      }
    }
    if (opening) {
      opening.sample = chapterOpening(time - opening.started);
      dirty = true;
      if (opening.sample.complete) {
        links.place(opening.guid, opening.cell);
        opening = null;
      }
    }
    if (closing) {
      closing.sample = chapterClosing(closing.cell, time - closing.started);
      dirty = true;
      if (closing.sample.complete) {
        links.place(closing.guid, CELLS[0]);
        closing = null;
      }
    }
  }
  function advanceStory(time) {
    const phase = nextStoryPhase(state, state.storyPhase);
    if (phase === state.storyPhase || (phase !== "ENDING" && inputBusy()))
      return;
    state.storyPhase = phase;
    state.version++;
    dirty = true;
    if (phase === "ENDING") endingStarted = viewChange?.started ?? time;
    if (phase === "CHAPTERS") {
      const guid = project.tree.attrs.staringCard,
        cell = state.coords.get(guid);
      if (cell) {
        opening = { guid, cell, started: time, sample: chapterOpening(0) };
        state.coords.delete(guid);
      }
    } else if (phase === "EPILOGUE") {
      const cell = CELLS.find((point) =>
        [...state.coords.values()].some(
          (at) => point[0] === at[0] && point[1] === at[1],
        ),
      );
      const guid =
        cell &&
        [...state.coords].find(
          ([, at]) => at[0] === cell[0] && at[1] === cell[1],
        )?.[0];
      if (guid) {
        closing = {
          guid,
          cell,
          started: time,
          sample: chapterClosing(cell, 0),
        };
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
  async function frame() {
    if (startup.active) {
      startup.update(performance.now() / 1000, bootReady && !ui.loading);
      if (!startup.active) {
        epoch = performance.now();
        ui.startupActive = false;
        if (startup.audioRequested && !settings.soundMuted) setSound(true);
      } else if (!bootReady || !startup.showingLast) {
        requestAnimationFrame(frame);
        return;
      }
    }
    if (!bootReady) return;
    if (pausedAt !== null) {
      requestAnimationFrame(frame);
      return;
    }
    try {
      const time = now(),
        viewpoint = navigationView(time);
      if (canvas.width !== BOARD_SIZE * 2) {
        canvas.width = canvas.height = BOARD_SIZE * 2;
        dirty = true;
      }
      updateBoardMotion(time);
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
      let reports = cards().map((card) => ({
        card,
        report: renderer.buildDrawList(card.location, {
          timeSeconds: time,
          graphicTimes,
          transitionLocations:
            viewChange?.card === card.guid
              ? viewChange.plan.locations
              : undefined,
          viewpoint: viewChange?.card === card.guid ? viewpoint : undefined,
        }),
      }));
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
              viewChange,
            );
            newClock = true;
          }
        }
      for (const guid of graphicTimes.keys())
        if (!active.has(guid)) graphicTimes.delete(guid);
      if (newClock)
        reports = reports.map(({ card }) => ({
          card,
          report: renderer.buildDrawList(card.location, {
            timeSeconds: time,
            graphicTimes,
            transitionLocations:
              viewChange?.card === card.guid
                ? viewChange.plan.locations
                : undefined,
            viewpoint: viewChange?.card === card.guid ? viewpoint : undefined,
          }),
        }));
      const hasAnimations = reports.some(({ report }) =>
        report.animations.some((a) => !a.complete),
      );
      blockedCards = new Set(
        reports
          .filter(({ card, report }) =>
            report.animations.some(
              (a) =>
                !a.complete &&
                project.get(a.guid)?.attrs.interactiveWhenAnimating !==
                  "true" &&
                project.owner(project.get(a.guid), "Card")?.attrs.guid ===
                  card.guid,
            ),
          )
          .map(({ card }) => card.guid),
      );
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
      if (dirty || hasAnimations || viewChange || newClock) {
        dirty = false;
        const frameState = state;
        // Decoding a card can yield to the browser. Keep the last finished board visible until every card is painted.
        frameContext.setTransform(1, 0, 0, 1, 0, 0);
        frameContext.clearRect(0, 0, boardFrame.width, boardFrame.height);
        frameContext.scale(2, 2);
        if (showGrid())
          paintGrid(
            frameContext,
            opening?.sample.progress ?? 1,
            closing?.sample.scale,
            closing?.sample.alpha,
          );
        const activeTextureUrls = reportTextureUrls(
          reports.map((entry) => entry.report),
        );
        waitingForBoardTextures = [...activeTextureUrls].some(
          (url) => !renderer.atlas.images.has(url),
        );
        updateBoardCursor();
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
              report,
            });
          } finally {
            frameContext.restore();
          }
        }
        waitingForBoardTextures = false;
        if (state !== frameState) {
          requestAnimationFrame(frame);
          return;
        }
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
    requestAnimationFrame(frame);
  }
  startupButton.addEventListener("click", () => {
    if (
      !settings.soundMuted &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    ) {
      interfaceBank
        .resume()
        .catch((error) => console.warn("界面声音暂未解锁", error));
      startup.enableMusic();
    }
  });
  board.addEventListener("pointerdown", () => {
    if (
      !settings.soundMuted &&
      !soundDirector &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    )
      setSound(true);
  });
  requestAnimationFrame(frame);
  try {
    const [{ project: loaded }, loadedManifest, atlases] = await Promise.all([
      loadProject(),
      read("assets/manifest.json"),
      read("assets/data/atlases.json"),
    ]);
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

  async function updateAudioPause() {
    if (!soundDirector) return;
    if (settings.soundMuted || pausedAt !== null) await soundDirector.suspend();
    else {
      await soundDirector.resume();
      syncSoundtrack();
    }
  }

  async function setSound(enabled, remember = false) {
    if (!bootReady || ui.soundBusy || interfaceSounds.disposed) return;
    ui.soundBusy = true;
    const previousMuted = settings.soundMuted;
    try {
      if (enabled) {
        // 两个上下文都在用户手势内发起解锁，必须早于任何网络请求。
        await Promise.all([soundBank.resume(), interfaceBank.resume()]);
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
