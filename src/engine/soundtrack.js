import { AudioBank } from './audio.js';
import { componentPath, ScoreDirector, trackGain } from './score.js';

const SFX_LIMIT = 4;

function append(index, key, event) {
  const entries = index.get(key);
  if (entries) entries.push(event);
  else index.set(key, [event]);
}

export class SoundtrackDirector {
  constructor(project, events, bank = new AudioBank()) {
    this.project = project;
    this.bank = bank;
    this.locations = new Map();
    this.animations = new Map();
    this.interface = new Map();
    this.layers = new Map();
    this.interfaceIndex = new Map();
    this.interfaceHandle = null;
    this.interfaceSerial = 0;
    this.effects = new Set();
    this.locationKey = null;
    this.score = new ScoreDirector(project, events, bank, {
      ramp: (...args) => this.ramp(...args),
      fadeOut: (...args) => this.fadeOut(...args),
    });

    for (const event of events) {
      const { source, attrs } = event;
      if (source.startsWith('soundtrack/amb_') && attrs.locPath) append(this.locations, attrs.locPath, event);
      if (attrs.type === 'sfx' && attrs.anim && !this.animations.has(attrs.anim)) {
        this.animations.set(attrs.anim, event);
      }
      if (source === 'soundtrack/interface_sfx' && attrs.type) append(this.interface, attrs.type, event);
    }
  }

  get running() {
    return this.bank.context?.state === 'running';
  }

  resume() {
    return this.bank.resume();
  }

  suspend() {
    return this.bank.context?.suspend();
  }

  syncScore(state, navigation) {
    if (this.score.sync(state, navigation) && this.locationKey) {
      const seconds = navigation?.destination === this.locationKey ? navigation.plan.durationSeconds : .01;
      this.syncLocation(this.locationKey, seconds, true);
    }
  }

  stop() {
    this.score.stop();
    this.interfaceSerial++;
    this.interfaceHandle = null;
    this.interfaceIndex.clear();
    this.effects.clear();
    this.layers.clear();
    this.locationKey = null;
    this.bank.stopAll();
  }

  ramp(handle, gain, pan, seconds) {
    const time = this.bank.context.currentTime;
    const level = handle.gain.gain;
    level.cancelScheduledValues(time);
    level.setValueAtTime(seconds ? level.value : gain, time);
    if (seconds) level.linearRampToValueAtTime(gain, time + seconds);
    if (handle.panner) {
      const balance = handle.panner.pan;
      balance.cancelScheduledValues(time);
      const target = pan * 2 - 1;
      balance.setValueAtTime(seconds ? balance.value : target, time);
      if (seconds) balance.linearRampToValueAtTime(target, time + seconds);
    }
  }

  fadeOut(handle, seconds) {
    if (!handle) return;
    if (!seconds) {
      handle.stop();
      return;
    }
    this.ramp(handle, 0, .5, seconds);
    try {
      handle.source.stop(this.bank.context.currentTime + seconds);
    } catch {
      handle.stop();
    }
  }

  ambientFor(location) {
    const scene = this.project.owner(location, 'Scene');
    const scenePath = componentPath(this.project, scene);
    const locationPath = componentPath(this.project, location);
    const byLayer = new Map();
    for (const path of [scenePath, locationPath]) {
      for (const event of this.locations.get(path) ?? []) {
        const { layer, milestone, volume, pan } = event.attrs;
        if (milestone && !this.score.isMilestoneActive(milestone)) continue;
        const name = layer || path + '#' + event.index;
        if (event.clipKey) {
          byLayer.set(name, {
            clipKey: event.clipKey,
            loop: event.attrs.loop !== 'false',
            volume: Number(volume ?? 1),
            pan: Number(pan ?? .5),
          });
        } else if (layer && byLayer.has(name)) {
          Object.assign(byLayer.get(name), { volume: Number(volume ?? 1), pan: Number(pan ?? .5) });
        }
      }
    }
    return byLayer;
  }

  syncLocation(locationGuid, seconds = .01, force = false) {
    if (!this.running || (!force && locationGuid === this.locationKey)) return;
    const location = this.project.get(locationGuid);
    if (locationGuid && location?.type !== 'SceneLocation') return;
    this.locationKey = locationGuid;
    const byLayer = location ? this.ambientFor(location) : new Map();

    for (const [layer, entry] of this.layers) {
      if (!byLayer.has(layer)) {
        this.layers.delete(layer);
        this.fadeOut(entry.handle, seconds);
      }
    }
    for (const [layer, settings] of byLayer) {
      const gain = trackGain(settings.volume);
      const pan = settings.pan;
      const previous = this.layers.get(layer);
      if (previous?.clipKey === settings.clipKey && previous.loop === settings.loop) {
        if (previous.handle && (previous.gain !== gain || previous.pan !== pan)) {
          this.ramp(previous.handle, gain, pan, seconds);
        }
        Object.assign(previous, { gain, pan, seconds });
        continue;
      }

      this.fadeOut(previous?.handle, seconds);
      const entry = { ...settings, gain, seconds, handle: null };
      this.layers.set(layer, entry);
      this.startAmbient(layer, entry).catch(error => {
        if (this.layers.get(layer) !== entry) return;
        this.layers.delete(layer);
        console.warn('环境音未播放', error);
      });
    }
  }

  async startAmbient(layer, entry) {
    const { buffer } = await this.bank.load(entry.clipKey);
    if (this.layers.get(layer) !== entry) return;
    const handle = await this.bank.play(entry.clipKey, {
      volume: entry.seconds ? 0 : entry.gain,
      pan: entry.pan,
      loop: entry.loop,
      offset: Math.random() * buffer.duration / 2,
      shouldPlay: () => this.layers.get(layer) === entry,
    });
    if (!handle) return;
    if (this.layers.get(layer) !== entry) {
      handle.stop();
      return;
    }
    entry.handle = handle;
    if (entry.seconds) this.ramp(handle, entry.gain, entry.pan, entry.seconds);
  }

  playGraphic(node, state, navigation) {
    if (!this.running || node?.attrs.soundtrackEnabled !== 'true' || this.effects.size >= SFX_LIMIT) return;
    const owner = this.project.owner(node, 'Card');
    const location = this.project.owner(node, 'SceneLocation');
    const cardGuid = owner?.attrs.guid;
    const locationGuid = location?.attrs.guid;
    if (!locationGuid || !state.inPlay.has(cardGuid)) return;
    if (locationGuid !== state.locations.get(cardGuid) &&
        !(navigation?.card === cardGuid && locationGuid === navigation.destination)) return;

    const event = this.animations.get(componentPath(this.project, node));
    if (!event?.clipKey) return;
    const slot = {};
    this.effects.add(slot);
    this.bank.play(event.clipKey, {
      volume: trackGain(Number(event.attrs.volume ?? 1)),
      pan: Number(event.attrs.pan ?? .5),
      when: Number(event.attrs.startDelay ?? 0),
      shouldPlay: () => this.effects.has(slot),
      onEnd: () => this.effects.delete(slot),
    }).catch(error => {
      this.effects.delete(slot);
      console.warn('动画音效未播放', error);
    });
  }

  playInterface(type) {
    if (!this.running) return;
    const entries = this.interface.get(type);
    if (!entries?.length) return;
    const index = this.interfaceIndex.get(type) ?? 0;
    this.interfaceIndex.set(type, (index + 1) % entries.length);
    const event = entries[index];
    const serial = ++this.interfaceSerial;
    this.interfaceHandle?.stop();
    this.interfaceHandle = null;
    this.bank.play(event.clipKey, {
      volume: trackGain(Number(event.attrs.volume ?? 1)),
      pan: Number(event.attrs.pan ?? .5),
      shouldPlay: () => serial === this.interfaceSerial,
    }).then(handle => {
      if (serial === this.interfaceSerial) this.interfaceHandle = handle;
      else handle?.stop();
    }).catch(error => console.warn('界面声音未播放', error));
  }
}
