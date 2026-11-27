import { BOARD_INSET, BOARD_SIZE } from "../engine/model/board.js";
import { CARD_SIZE } from "../engine/render/camera.js";
import {
  failedTextureUrls,
  needsBoardBackdrop,
} from "../engine/render/renderer.js";

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

export function createBoardPresentation(canvas) {
  const ctx = canvas.getContext("2d");
  const boardFrame = document.createElement("canvas");
  boardFrame.width = boardFrame.height = canvas.width;
  const frameContext = boardFrame.getContext("2d");
  const cardLayerHost = document.createElement("div");
  cardLayerHost.className = "board-card-layers";
  cardLayerHost.setAttribute("aria-hidden", "true");
  cardLayerHost.style.setProperty(
    "--card-layer-size",
    `${(100 * CARD_SIZE) / BOARD_SIZE}%`,
  );
  canvas.after(cardLayerHost);
  const cardLayers = new Map();
  const touchPrimary = window.matchMedia("(pointer: coarse)");
  let backdropDrawing = null;
  let rasterScale = canvas.width / BOARD_SIZE;
  let density = 0;
  let resizePending = true;

  function resizeBoard() {
    const nextDensity = Math.min(
      globalThis.devicePixelRatio || 1,
      touchPrimary.matches ? 1.5 : 2,
    );
    if (!resizePending && density === nextDensity) return false;
    density = nextDensity;
    resizePending = false;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return false;
    const pixels = Math.min(
      BOARD_SIZE * 2,
      Math.max(1, Math.round(Math.min(width, height) * density)),
    );
    if (boardFrame.width === pixels) return false;
    boardFrame.width = boardFrame.height = pixels;
    rasterScale = pixels / BOARD_SIZE;
    return true;
  }
  function positionCardLayer(layer, [x, y]) {
    if (layer.x === x && layer.y === y) return;
    layer.canvas.style.transform = `translate(${(100 * x) / CARD_SIZE}%, ${(100 * y) / CARD_SIZE}%)`;
    layer.x = x;
    layer.y = y;
  }
  async function paintCardLayers(entries, renderer, textureFailures) {
    const paints = [];
    const layers = entries.map(({ card, report, position }) => {
      let layer = cardLayers.get(card.guid);
      if (!layer) {
        const canvas = document.createElement("canvas");
        canvas.className = "board-card-layer";
        layer = { canvas };
      }
      if (layer.report !== report || layer.rasterScale !== rasterScale) {
        const paint = renderer.renderCardLayer(
          layer.canvas,
          card.location,
          report,
          rasterScale,
          textureFailures,
        );
        if (paint) paints.push(paint);
      }
      return { guid: card.guid, position, layer, report };
    });
    if (paints.length) await Promise.all(paints);
    return layers;
  }
  function presentCardLayers(layers, textureFailures) {
    const visible = new Set(layers.map(({ guid }) => guid));
    for (const [guid, layer] of cardLayers) {
      if (visible.has(guid)) continue;
      layer.canvas.remove();
      cardLayers.delete(guid);
    }
    for (const [order, { guid, position, layer, report }] of layers.entries()) {
      layer.report = textureFailures.size ? null : report;
      layer.rasterScale = rasterScale;
      if (!cardLayers.has(guid)) {
        cardLayers.set(guid, layer);
        cardLayerHost.append(layer.canvas);
      }
      positionCardLayer(layer, position);
      if (layer.order !== order) {
        layer.canvas.style.zIndex = order;
        layer.order = order;
      }
    }
  }
  async function present(
    entries,
    { renderer, textureFailures, layered, grid, canPresent },
  ) {
    if (!canPresent()) return false;
    // 擦除必须作用于网格和下方卡片。其上方的卡片仍可独立显示。
    const backdropCount = layered
      ? entries.findLastIndex(({ report }) => needsBoardBackdrop(report)) + 1
      : entries.length;
    const backdrop = entries.slice(0, backdropCount);
    const drawing = layered
      ? JSON.stringify([
          rasterScale,
          grid,
          backdrop.map(({ report, position }) => [position, report.drawn]),
          failedTextureUrls(
            backdrop.map(({ report }) => report),
            textureFailures,
          ),
        ])
      : null;
    const repaint = drawing === null || drawing !== backdropDrawing;
    if (repaint) {
      frameContext.setTransform(1, 0, 0, 1, 0, 0);
      frameContext.clearRect(0, 0, boardFrame.width, boardFrame.height);
      frameContext.scale(rasterScale, rasterScale);
      if (grid) paintGrid(frameContext, ...grid);
      for (const {
        card,
        report,
        position: [x, y],
      } of backdrop) {
        frameContext.save();
        frameContext.translate(x, y);
        frameContext.fillStyle = "#f2f2f0";
        frameContext.fillRect(0, 0, CARD_SIZE, CARD_SIZE);
        try {
          await renderer.render(frameContext, card.location, {
            rasterScale,
            report,
            textureFailures,
          });
        } finally {
          frameContext.restore();
        }
      }
    }
    if (!canPresent()) return false;
    const layers = await paintCardLayers(
      entries.slice(backdropCount),
      renderer,
      textureFailures,
    );
    if (!canPresent()) return false;
    presentCardLayers(layers, textureFailures);
    if (repaint) {
      if (
        canvas.width !== boardFrame.width ||
        canvas.height !== boardFrame.height
      )
        canvas.width = canvas.height = boardFrame.width;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(boardFrame, 0, 0);
      backdropDrawing = drawing;
    }
    return true;
  }
  function moveDraggedCard(guid, position) {
    const draggedLayer = cardLayers.get(guid);
    if (draggedLayer) {
      positionCardLayer(draggedLayer, position);
      if (draggedLayer.order !== cardLayers.size) {
        draggedLayer.canvas.style.zIndex = cardLayers.size;
        draggedLayer.order = cardLayers.size;
      }
    }
  }

  function dispose() {
    cardLayers.clear();
    cardLayerHost.remove();
  }

  return {
    resize: resizeBoard,
    requestResize() {
      resizePending = true;
    },
    invalidateBackdrop() {
      backdropDrawing = null;
    },
    moveDraggedCard,
    present,
    dispose,
  };
}
