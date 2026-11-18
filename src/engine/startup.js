// Windows level0, SplashController component 1233 and its three Resources sprite paths.
export const STARTUP_SLIDES = [
  { key: 'resources-assets/496', url: 'assets/textures/resources-assets-496-AnnapurnaInteractive_Logo_black-on-transparent.png', label: 'Annapurna Interactive' },
  { key: 'resources-assets/629', url: 'assets/textures/resources-assets-629-bs_logo_trans.png', label: 'Buried Signal' },
  { key: 'resources-assets/476', url: 'assets/textures/resources-assets-476-Seq_GOR_logo_v01_trans.png', label: 'Gorogoa' },
];
export const STARTUP_MUSIC = 'sharedassets0.assets/120';

const FADE = 1;
const HOLD = 1;
const SLIDE_SECONDS = 2 * FADE + HOLD;
const LAST_START = (STARTUP_SLIDES.length - 1) * SLIDE_SECONDS;

export class StartupScreen {
  constructor(button, bank, baseUrl) {
    this.button = button;
    this.bank = bank;
    this.active = true;
    this.showingLast = false;
    this.index = -1;
    this.images = STARTUP_SLIDES.map(({ url, label }) => {
      const image = new Image();
      image.src = new URL(url, baseUrl).href;
      image.alt = label;
      image.draggable = false;
      return image;
    });
    Promise.allSettled(this.images.map(image => image.decode())).then(() => {
      this.started = performance.now() / 1000;
    });
  }

  async enableMusic() {
    if (!this.active || this.audioRequested) return;
    this.audioRequested = true;
    try {
      await this.bank.resume();
      const { buffer } = await this.bank.load(STARTUP_MUSIC);
      const offset = this.started === undefined ? 0 : Math.max(0, performance.now() / 1000 - this.started);
      if (!this.active || offset >= buffer.duration) return;
      const track = await this.bank.play(STARTUP_MUSIC, {
        channel: 'music', offset, shouldPlay: () => this.active,
      });
      if (!track) return;
      if (!this.active) track.stop();
      else {
        this.track = track;
        if (this.backgroundFade !== undefined) this.fadeMusic(performance.now() / 1000);
      }
    } catch (error) {
      this.audioRequested = false;
      console.warn('启动序曲未播放', error);
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
    const index = Math.min(Math.floor(elapsed / SLIDE_SECONDS), STARTUP_SLIDES.length - 1);
    const inSlide = elapsed - index * SLIDE_SECONDS;
    this.showingLast = elapsed >= LAST_START;
    if (this.index !== index) {
      this.index = index;
      this.button.replaceChildren(this.images[index]);
    }
    let opacity = Math.min(1, inSlide / FADE, (SLIDE_SECONDS - inSlide) / FADE);
    if (this.showingLast) {
      if (inSlide >= FADE + HOLD && boardReady) this.lastFade ??= time;
      opacity = Math.min(1, inSlide / FADE, this.lastFade === undefined ? 1 : 1 - (time - this.lastFade) / FADE);
    }
    this.images[index].style.opacity = String(Math.max(0, opacity));
    if (this.lastFade === undefined || time - this.lastFade < FADE) return;
    if (this.backgroundFade === undefined) {
      this.backgroundFade = this.lastFade + FADE;
      this.fadeMusic(time);
    }
    const remaining = 1 - (time - this.backgroundFade) / FADE;
    this.button.style.opacity = String(Math.max(0, remaining));
    if (remaining <= 0) this.finish();
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
