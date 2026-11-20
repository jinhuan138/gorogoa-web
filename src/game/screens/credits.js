import { ManualTimeline } from "../timeline.js";

export class EndingCredits {
  constructor(root, page, previous, next, arrowImages) {
    Object.assign(this, { root, page, previous, next });
    for (const [button, image] of [
      [previous, arrowImages.previous],
      [next, arrowImages.next],
    ]) {
      if (!image) continue;
      button.style.backgroundImage = `url("${image}")`;
      button.textContent = "";
    }
    previous.addEventListener("click", () => this.advance(-1));
    next.addEventListener("click", () => this.advance(1));
    this.reset();
  }

  reset() {
    this.data = null;
    this.root.hidden = true;
  }

  start(data, time) {
    this.data = data;
    this.time = time;
    this.setPage(0, time);
  }

  setPage(index, time) {
    this.index = index;
    this.pageStarted = time;
    const current = this.data.pages[index];
    this.root.hidden = !current;
    this.previous.hidden = index === 0;
    if (!current) return;
    const { fadeIn, fadeOut } = this.data;
    this.duration = fadeIn + current.hold + fadeOut;
    this.timeline = new ManualTimeline({ opacity: 0 })
      .add({ opacity: [0, 1] }, fadeIn)
      .add({ opacity: [1, 0] }, fadeOut, fadeIn + current.hold);
    this.page.replaceChildren();
    for (const { style, text, offset } of current.lines) {
      const line = document.createElement(style === "Text" ? "p" : "h2");
      line.className = `credit-${style.toLowerCase()}`;
      line.style.marginTop = `calc(var(--credit-unit) * ${offset + this.data.spacing})`;
      for (const part of text.split(/(<b>.*?<\/b>)/g)) {
        if (!part.startsWith("<b>")) {
          line.append(part);
          continue;
        }
        const bold = document.createElement("strong");
        bold.textContent = part.slice(3, -4);
        line.append(bold);
      }
      this.page.append(line);
    }
  }

  advance(direction) {
    if (this.root.hidden) return;
    this.setPage(Math.max(0, this.index + direction), this.time);
    this.update(this.time);
  }

  update(time) {
    if (!this.data || this.root.hidden) return;
    this.time = time;
    while (time - this.pageStarted >= this.duration) {
      this.setPage(this.index + 1, this.pageStarted + this.duration);
      if (this.root.hidden) return;
    }
    this.page.style.opacity = String(
      this.timeline.seek(time - this.pageStarted).opacity,
    );
  }
}
