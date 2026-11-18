export class EndingCredits {
  constructor(root, page, previous, next, arrowImages) {
    Object.assign(this, { root, page, previous, next });
    for (const [button, image] of [[previous, arrowImages.previous], [next, arrowImages.next]]) {
      if (!image) continue;
      button.style.backgroundImage = `url("${image}")`;
      button.textContent = '';
    }
    previous.addEventListener('click', () => this.advance(-1));
    next.addEventListener('click', () => this.advance(1));
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
    this.page.replaceChildren();
    for (const { style, text, offset } of current.lines) {
      const line = document.createElement(style === 'Text' ? 'p' : 'h2');
      line.className = `credit-${style.toLowerCase()}`;
      line.style.marginTop = `calc(var(--credit-unit) * ${offset + this.data.spacing})`;
      for (const part of text.split(/(<b>.*?<\/b>)/g)) {
        if (!part.startsWith('<b>')) {
          line.append(part);
          continue;
        }
        const bold = document.createElement('strong');
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
    const { fadeIn, fadeOut, pages } = this.data;
    let duration = fadeIn + pages[this.index].hold + fadeOut;
    while (time - this.pageStarted >= duration) {
      this.setPage(this.index + 1, this.pageStarted + duration);
      if (this.root.hidden) return;
      duration = fadeIn + pages[this.index].hold + fadeOut;
    }
    const elapsed = time - this.pageStarted;
    this.page.style.opacity = String(Math.min(1, elapsed / fadeIn, (duration - elapsed) / fadeOut));
  }
}
