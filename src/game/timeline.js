import { createTimeline } from "animejs/timeline";
import { engine } from "animejs/engine";

// 所有时间线由现有游戏时钟推进，不启动第二套 RAF；暂停的时间线不进引擎，丢弃即可。
engine.useDefaultMainLoop = false;

export class ManualTimeline {
  constructor(values) {
    this.values = values;
    this.animation = createTimeline({
      autoplay: false,
      defaults: { ease: "linear" },
    });
  }

  add(values, durationSeconds, atSeconds = 0) {
    this.animation.add(
      this.values,
      { ...values, duration: durationSeconds * 1000 },
      atSeconds * 1000,
    );
    return this;
  }

  seek(elapsedSeconds) {
    this.animation.seek(elapsedSeconds * 1000, true);
    return this.values;
  }
}
