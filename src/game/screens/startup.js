import { ManualTimeline } from "../timeline.js";

// Windows level0, SplashController component 1233 and its three Resources sprite paths.
export const STARTUP_SLIDES = [
  {
    key: "resources-assets/496",
    url: "assets/textures/resources-assets-496-AnnapurnaInteractive_Logo_black-on-transparent.png",
    label: "Annapurna Interactive",
  },
  {
    key: "resources-assets/629",
    url: "assets/textures/resources-assets-629-bs_logo_trans.png",
    label: "Buried Signal",
  },
  {
    key: "resources-assets/476",
    url: "assets/textures/resources-assets-476-Seq_GOR_logo_v01_trans.png",
    label: "Gorogoa",
  },
];
export const STARTUP_MUSIC = "sharedassets0.assets/120";

const FADE = 1;
const HOLD = 1;
const SLIDE_SECONDS = 2 * FADE + HOLD;
const LAST_START = (STARTUP_SLIDES.length - 1) * SLIDE_SECONDS;

export class StartupScreen {
  constructor(
    button,
    bank,
    baseUrl,
    gameName = () => "Gorogoa",
    {
      now = () => performance.now() / 1000,
      isPaused = () => false,
      resume = () => bank.resume(),
      onProgress = () => {},
    } = {},
  ) {
    this.button = button;
    this.bank = bank;
    this.gameName = gameName;
    this.now = now;
    this.isPaused = isPaused;
    this.resume = resume;
    this.active = true;
    this.showingLast = false;
    this.index = -1;
    this.timeline = new ManualTimeline({ logo: 0, background: 1 });
    for (let index = 0; index < STARTUP_SLIDES.length; index++) {
      const start = index * SLIDE_SECONDS;
      this.timeline.add({ logo: [0, 1] }, FADE, start);
      if (index < STARTUP_SLIDES.length - 1)
        this.timeline.add({ logo: [1, 0] }, FADE, start + FADE + HOLD);
    }
    this.images = STARTUP_SLIDES.map(({ url, label }) => {
      const image = new Image();
      image.src = new URL(url, baseUrl).href;
      image.alt = label;
      image.draggable = false;
      return image;
    });
    const total = this.images.length;
    let completed = 0;
    let failed = 0;
    const reportImage = (loaded) => {
      if (loaded) completed++;
      else failed++;
      if (this.active) onProgress(completed, total, failed);
    };
    Promise.allSettled(
      this.images.map((image) =>
        image.decode().then(
          () => reportImage(true),
          () => reportImage(false),
        ),
      ),
    ).then(() => {
      if (this.active) this.started = this.now();
    });
  }

  async enableMusic() {
    if (!this.active || this.isPaused() || this.audioRequested) return;
    this.audioRequested = true;
    try {
      await this.resume();
      if (!this.active) return;
      const { buffer } = await this.bank.load(STARTUP_MUSIC);
      const offset =
        this.started === undefined ? 0 : Math.max(0, this.now() - this.started);
      if (!this.active || offset >= buffer.duration) return;
      const track = await this.bank.play(STARTUP_MUSIC, {
        channel: "music",
        offset,
        shouldPlay: () => this.active,
      });
      if (!track) return;
      if (!this.active) track.stop();
      else {
        this.track = track;
        if (this.backgroundFade !== undefined) this.fadeMusic(this.now());
      }
    } catch (error) {
      this.audioRequested = false;
      console.warn("启动序曲未播放", error);
    }
  }

  fadeMusic(time) {
    if (!this.track) return;
    const now = this.bank.context.currentTime;
    const left = Math.max(0, this.backgroundFade + FADE - time);
    const volume = this.track.gain.gain;
    volume.setValueAtTime(left / FADE, now);
    if (left) volume.linearRampToValueAtTime(0, now + left);
  }

  update(time, boardReady) {
    if (!this.active || this.started === undefined) return;
    const elapsed = time - this.started;
    const index = Math.min(
      Math.floor(elapsed / SLIDE_SECONDS),
      STARTUP_SLIDES.length - 1,
    );
    this.showingLast = elapsed >= LAST_START;
    if (this.index !== index) {
      this.index = index;
      this.button.replaceChildren(this.images[index]);
    }
    if (
      elapsed >= LAST_START + FADE + HOLD &&
      boardReady &&
      this.lastFade === undefined
    ) {
      this.lastFade = time;
      this.timeline
        .add({ logo: [1, 0] }, FADE, elapsed)
        .add({ background: [1, 0] }, FADE, elapsed + FADE);
    }
    const visual = this.timeline.seek(elapsed);
    this.images[index].alt = this.showingLast
      ? this.gameName()
      : STARTUP_SLIDES[index].label;
    this.images[index].style.opacity = String(visual.logo);
    if (this.lastFade === undefined || time - this.lastFade < FADE) return;
    if (this.backgroundFade === undefined) {
      this.backgroundFade = this.lastFade + FADE;
      this.fadeMusic(time);
    }
    this.button.style.opacity = String(visual.background);
    if (time - this.backgroundFade >= FADE) this.finish();
  }

  finish() {
    this.active = false;
    this.button.hidden = true;
    this.button.replaceChildren();
    this.track?.stop();
    this.track = undefined;
    this.images = [];
  }
}
