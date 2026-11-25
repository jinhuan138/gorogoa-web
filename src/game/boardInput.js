import {
  BOARD_SIZE,
  beginCardDrag,
  cancelCardDrag,
  planCardDrop,
} from "../engine/model/board.js";
import { CARD_SIZE } from "../engine/render/camera.js";

export function createBoardInput({
  canvas,
  board,
  listen,
  getState,
  getLinks,
  cards,
  placement,
  showGrid,
  inputBusy,
  canMove,
  isMotionBusy,
  isBackgrounded,
  isDisposed,
  isWaitingForTextures,
  showHints,
  activeTransitions,
  invalidate,
  markDirty,
  onReveal,
  onLift,
  playHint,
  onDrop,
}) {
  const rotatedMobileStage = window.matchMedia(
    "(pointer: coarse) and (orientation: portrait)",
  );
  let drag = null;
  let press = null;
  let tap = null;
  let pendingTouchMove = null;

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

  function setHover(event) {
    const state = getState();
    if (!state || isBackgrounded() || isDisposed()) return;
    const card = hitCard(logicalPoint(event)),
      old = [...state.hovered].join(",");
    state.hovered.clear();
    if (card) state.hovered.add(card.guid);
    if (old !== [...state.hovered].join(",")) invalidate();
    updateBoardCursor();
  }
  function updateBoardCursor() {
    if (isWaitingForTextures() && !drag) return;
    const state = getState();
    const hovered = [...state.hovered][0];
    const waiting = isMotionBusy() || (hovered && !canMove(hovered));
    const canDrag = hovered && state.coords.has(hovered) && showGrid();
    const cursor = drag
      ? "move"
      : waiting
        ? "wait"
        : canDrag
          ? "move"
          : "default";
    if (board.dataset.cursor !== cursor) board.dataset.cursor = cursor;
  }
  listen(board, "pointerdown", (event) => {
    const state = getState();
    if (!state || inputBusy(true) || !event.isPrimary || event.button !== 0)
      return;
    if (pendingTouchMove?.pointerId === event.pointerId)
      pendingTouchMove = null;
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
      origin,
      offset: point.map((v, i) => v - origin[i]),
    };
  });
  function updatePointerPosition(event) {
    if (drag && event.pointerId === drag.id) {
      drag.topLeft = logicalPoint(event).map((v, i) => v - drag.offset[i]);
      markDirty();
      updateBoardCursor();
    } else setHover(event);
  }
  function flushTouchMove() {
    const event = pendingTouchMove;
    pendingTouchMove = null;
    if (event) updatePointerPosition(event);
  }
  listen(board, "pointermove", (event) => {
    if (!getState() || isBackgrounded() || isDisposed() || !event.isPrimary)
      return;
    if (press && event.pointerId === press.id && !event.buttons && !drag)
      press = null;
    if (
      press &&
      event.pointerId === press.id &&
      !drag &&
      !inputBusy(true) &&
      canMove(press.guid) &&
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
        7
    ) {
      drag = {
        ...beginCardDrag(getLinks(), press.guid),
        offset: press.offset,
        topLeft: press.origin,
        id: press.id,
      };
      if (drag.direction === "OVER") onReveal(drag);
      board.setPointerCapture(event.pointerId);
      onLift();
      press = tap = null;
    }
    if (event.pointerType === "touch") pendingTouchMove = event;
    else updatePointerPosition(event);
  });
  listen(board, "pointerleave", (event) => {
    // 触摸抬起也会触发离开；保留最后触及的卡片，让下一帧处理原版入场条件。
    const state = getState();
    if (state && !drag && event.pointerType !== "touch") {
      press = tap = null;
      state.hovered.clear();
      invalidate();
      updateBoardCursor();
    }
  });
  function hintAt(point) {
    if (!showHints() || inputBusy()) return;
    const card = hitCard(point);
    const snapshot = getState();
    const shouldPlay = () =>
      getState() === snapshot && !inputBusy() && showHints();
    if (card && !canMove(card.guid)) {
      playHint("nonInteractive", { shouldPlay });
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
      playHint("ping", { shouldPlay });
    // 原版 m_sfxPingEmpty 未绑定素材，没有 REGION 热点时保持无声。
  }
  listen(board, "pointerup", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (pendingTouchMove?.pointerId === event.pointerId) {
      if (drag?.id === event.pointerId) pendingTouchMove = null;
      else flushTouchMove();
    }
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
    const plan = planCardDrop(getLinks(), current, topLeft, canMove);
    if (plan) onDrop(current, plan);
    else cancelCardDrag(getLinks(), current);
    markDirty();
  });
  function abandonPointer(event) {
    if (pendingTouchMove?.pointerId === event.pointerId)
      pendingTouchMove = null;
    if (event.pointerId === tap?.id) tap = null;
    if (event.pointerId === press?.id) press = null;
    if (event.pointerId !== drag?.id) return;
    cancelCardDrag(getLinks(), drag);
    drag = null;
    markDirty();
  }
  listen(board, "pointercancel", abandonPointer);
  listen(board, "lostpointercapture", (event) => {
    // 触摸的隐式捕获从子元素转交棋盘时，子元素的失去捕获事件也会冒泡。
    if (event.target === board) abandonPointer(event);
  });
  function cancelPointer() {
    const current = drag;
    reset();
    if (!current) return;
    cancelCardDrag(getLinks(), current);
    if (board.hasPointerCapture(current.id))
      board.releasePointerCapture(current.id);
    markDirty();
  }

  function reset() {
    drag = press = tap = pendingTouchMove = null;
  }

  return {
    get drag() {
      return drag;
    },
    flushTouchMove,
    cancelPointer,
    reset,
    updateBoardCursor,
  };
}
