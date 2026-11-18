const CACHE_BUDGET = 96 * 1024 * 1024;

/** 原版声音资源播放器。通过用户操作启用上下文后才播放。 */
export class AudioBank {
  constructor(contextOrOptions = {}) {
    const isContext = typeof contextOrOptions?.decodeAudioData === 'function';
    this.context = isContext ? contextOrOptions : null;
    this.baseUrl = (isContext ? undefined : contextOrOptions.baseUrl) || globalThis.document?.baseURI;
    this.manifest = null;
    this.pending = new Map();
    this.buffers = new Map();
    this.cachedBytes = 0;
    this.playing = new Set();
    this.channelVolumes = new Map([['music', 1], ['effects', 1]]);
    this.channels = new Map();
  }

  setChannelVolume(channel, volume) {
    if (!this.channelVolumes.has(channel) || !Number.isFinite(volume)) return;
    const level = Math.max(0, Math.min(1, volume));
    this.channelVolumes.set(channel, level);
    const output = this.channels.get(channel);
    if (output) output.gain.setTargetAtTime(level, this.context.currentTime, .015);
  }

  channelOutput(channel) {
    const context = this.context;
    if (!this.channelVolumes.has(channel)) return context.destination;
    if (!this.channels.has(channel)) {
      const output = context.createGain();
      output.gain.value = this.channelVolumes.get(channel);
      output.connect(context.destination);
      this.channels.set(channel, output);
    }
    return this.channels.get(channel);
  }

  loadManifest() {
    if (!this.baseUrl) throw new Error('缺少音频资源根 URL');
    if (!this.manifest) {
      this.manifest = (async () => {
        const response = await fetch(new URL('assets/audio/manifest.json', this.baseUrl));
        if (!response.ok) throw new Error(`音频目录读取失败 (${response.status})`);
        return response.json();
      })().catch(error => {
        this.manifest = null;
        throw error;
      });
    }
    return this.manifest;
  }

  async resume() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('浏览器不支持 Web Audio');
      this.context = new Context();
    }
    if (this.context.state !== 'running') await this.context.resume();
    return this.context;
  }

  async load(name) {
    if (!this.context) throw new Error('请先通过用户操作启用声音');
    const manifest = await this.loadManifest();
    const matches = manifest.clips.filter(clip => clip.name === name || clip.key === name);
    if (!matches.length) throw new Error(`音频尚未恢复：${name}`);
    if (new Set(matches.map(clip => clip.dataSha256)).size > 1) throw new Error(`音频名称多义：${name}`);
    const clip = matches[0];
    const cached = this.buffers.get(clip.key);
    if (cached) {
      this.buffers.delete(clip.key);
      this.buffers.set(clip.key, cached);
      return cached;
    }
    if (!this.pending.has(clip.key)) {
      const pending = (async () => {
        const response = await fetch(new URL(clip.url, this.baseUrl));
        if (!response.ok) throw new Error(`声音读取失败 (${response.status})`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (buffer.numberOfChannels !== clip.channels) throw new Error(`声音声道数不符：${name}`);
        const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
        const entry = { clip, buffer, bytes };
        if (bytes <= CACHE_BUDGET) {
          this.buffers.set(clip.key, entry);
          this.cachedBytes += bytes;
          while (this.cachedBytes > CACHE_BUDGET) {
            const [key, oldest] = this.buffers.entries().next().value;
            this.buffers.delete(key);
            this.cachedBytes -= oldest.bytes;
          }
        }
        return entry;
      })().finally(() => this.pending.delete(clip.key));
      this.pending.set(clip.key, pending);
    }
    return this.pending.get(clip.key);
  }

  async decodeAll(names) {
    const manifest = await this.loadManifest();
    const results = [];
    for (const name of names || manifest.clips.map(clip => clip.key)) {
      try {
        const { clip, buffer } = await this.load(name);
        results.push({
          name: clip.name, key: clip.key, decoded: true, channels: buffer.numberOfChannels,
          sampleRate: buffer.sampleRate, duration: buffer.duration, expectedDuration: clip.durationExpected,
          durationDifference: buffer.duration - clip.durationExpected,
        });
      } catch (error) {
        results.push({ name, decoded: false, error: error.message });
      }
    }
    return results;
  }

  async play(name, {
    volume = 1, pan = .5, loop = false, when = 0, offset = 0, duration, playbackRate = 1, channel = 'effects',
    shouldPlay = () => true, onEnd = () => {},
  } = {}) {
    if (!this.context) throw new Error('请先通过用户操作启用声音');
    const { clip, buffer } = await this.load(name);
    if (!shouldPlay()) return null;

    const context = this.context;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createStereoPanner?.();
    const output = this.channelOutput(channel);
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = playbackRate;
    gain.gain.value = Math.max(0, Math.min(4, volume));
    source.connect(gain);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan * 2 - 1));
      gain.connect(panner);
      panner.connect(output);
    } else {
      gain.connect(output);
    }

    const clean = () => {
      if (!this.playing.delete(record)) return;
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
      onEnd();
    };
    const stop = () => {
      if (!this.playing.has(record)) return;
      try {
        source.stop();
      } catch {
        // A scheduled source may already have ended.
      }
      clean();
    };
    const start = context.currentTime + Math.max(0, when);
    const record = { clip, source, gain, panner, stop, startedAt: start };
    source.onended = clean;
    this.playing.add(record);
    try {
      if (duration === undefined) source.start(start, offset);
      else source.start(start, offset, duration);
    } catch (error) {
      clean();
      throw error;
    }
    return record;
  }

  stopAll() {
    for (const item of this.playing) item.stop();
  }
}
