import { sampleTransition } from "../engine/model/navigation.js";
import {
  BOARD_INSET,
  chapterOpening,
  chapterClosing,
  sampleCardDrop,
} from "../engine/model/board.js";
import { CARD_SIZE } from "../engine/render/camera.js";

// 顺序也是每帧业务结果的提交顺序。
const samplers = {
  navigation: ({ plan }, elapsed) => sampleTransition(plan, elapsed),
  flight: ({ plan }, elapsed) => sampleCardDrop(plan, elapsed),
  opening: (_, elapsed) => chapterOpening(elapsed),
  closing: ({ cell }, elapsed) => chapterClosing(cell, elapsed),
};

export class GameMotion {
  constructor(onComplete) {
    this.onComplete = onComplete;
    this.cancel();
  }

  get busy() {
    return Object.keys(samplers).some((type) => this[type]);
  }

  start(type, data, started) {
    return (this[type] = {
      ...data,
      started,
      sample: samplers[type](data, 0),
    });
  }

  update(time) {
    const changed = this.busy;
    for (const type of Object.keys(samplers)) {
      const move = this[type];
      if (!move) continue;
      move.sample = samplers[type](move, time - move.started);
      if (!move.sample.complete) continue;
      // 先清空再提交，回调里开启的新运动不会被覆盖。
      this[type] = null;
      this.onComplete[type](move);
    }
    return changed;
  }

  position(guid, includeClosing = true) {
    if (this.flight?.drag.draggedGUID === guid)
      return this.flight.sample.dragged;
    if (this.flight?.plan.shuffle?.guid === guid)
      return this.flight.sample.shuffled;
    if (this.opening?.guid === guid) return this.opening.sample.position;
    if (includeClosing && this.closing?.guid === guid)
      return this.closing.sample.position;
  }

  displayCoords(guid, drag) {
    const pixels =
      drag?.draggedGUID === guid ? drag.topLeft : this.position(guid, false);
    return pixels?.map((value) => (value - BOARD_INSET) / CARD_SIZE);
  }

  cancel() {
    for (const type of Object.keys(samplers)) this[type] = null;
  }
}
