const FOREGROUND = Symbol('Score Foreground');
const LOCAL_LAYER_COUNT = 4;
const silence = { clipKey: null, volume: 1, pan: .5, fade: 1, delay: 0, loop: false, interrupt: true };

export function componentPath(project, node) {
  const ids = [];
  for (let part = node; part && part !== project.tree; part = project.parent.get(part)) {
    if (part.attrs.id) ids.push(part.attrs.id);
  }
  return ids.reverse().join('/');
}

// Track.setVolume applies the original quantized logarithmic fader.
export function trackGain(value) {
  const volume = Math.max(0, Math.min(1, value));
  if (volume <= .001) return 0;
  const fraction = Math.fround((Math.fround(10 ** volume) - 1) / 9);
  const scaled = Math.fround(100 * Math.fround(1 / fraction));
  const nearest = Math.round(scaled);
  const decibelsInv = nearest - scaled === .5 && nearest % 2 ? nearest - 1 : nearest;
  return Math.fround(1 / Math.fround(Math.fround(.01) * decibelsInv));
}

// ProjectComponent._ImportAttributes allocates a distinct auto ID for entries
// with no XML ID. Use their source/index to preserve that distinction here.
const eventId = event => event.attrs.id || event.source + '#' + event.index;
const seconds = value => Math.trunc(Math.fround(Math.fround(Number(value ?? 0)) * 1000)) / 1000;

function settings(event) {
  if (!event?.clipKey) return event?.attrs.interrupt === 'false' ? { ...silence, interrupt: false } : silence;
  const a = event.attrs;
  const interrupt = a.interrupt !== 'false';
  return {
    clipKey: event.clipKey,
    volume: Number(a.volume ?? 1),
    pan: Number(a.pan ?? .5),
    fade: Math.max(interrupt ? 0 : .1, seconds(a.fadeIn)),
    delay: Math.max(0, seconds(a.startDelay)),
    loop: a.loop !== 'false',
    interrupt,
  };
}

/** Original per-card score plus the foreground milestone score. */
export class ScoreDirector {
  constructor(project, events, bank, { ramp, fadeOut }) {
    this.project = project;
    this.bank = bank;
    this.ramp = ramp;
    this.fadeOut = fadeOut;
    this.local = new Map();
    this.cues = new Map();
    this.ambientMilestones = new Set();
    this.voices = new Map();
    this.activeMilestones = new Map();
    this.played = new Set();
    this.lastNavigation = null;
    this.grid = null;
    for (const event of events) {
      const { type, locPath, milestone } = event.attrs;
      if (milestone && event.source.startsWith('soundtrack/amb_')) this.ambientMilestones.add(milestone);
      if (type !== 'music') continue;
      if (locPath && !this.local.has(locPath)) this.local.set(locPath, event);
      if (!locPath && milestone && !this.cues.has(milestone)) this.cues.set(milestone, event);
    }
    this.sequences = project.container(project.tree, 'milestoneSequences', 'MilestoneSequence').map(sequence => ({
      sequence,
      milestones: project.container(sequence, 'milestones', 'Milestone').map(milestone => ({
        path: componentPath(project, milestone),
        predicate: project.container(milestone, 'predicate')[0],
      })),
    })).filter(({ milestones }) => milestones.some(({ path }) => this.cues.has(path) || this.ambientMilestones.has(path)));
  }

  stop() {
    // SoundtrackDirector stops all sources after invalidating asynchronous starts.
    this.voices.clear();
    this.activeMilestones.clear();
    this.played.clear();
    this.lastNavigation = null;
    this.grid = null;
  }

  sync(state, navigation) {
    if (this.bank.context?.state !== 'running') return;
    const now = this.bank.context.currentTime;
    // Grid changes and capture of audio focus reevaluate every stable card.
    const grid = JSON.stringify([[...state.inPlay], [...state.coords], [...state.captors]]);
    const refreshAll = grid !== this.grid || Boolean(navigation && navigation !== this.lastNavigation);
    this.grid = grid;
    this.lastNavigation = navigation;
    for (const [key, voice] of this.voices) {
      if (key !== FOREGROUND && !state.inPlay.has(key)) {
        this.voices.delete(key);
        this.fadeOut(voice.current?.handle, 1);
      }
    }
    for (const guid of state.inPlay) {
      const voice = this.voice(guid);
      if (!voice) continue;
      if (navigation?.card === guid) {
        voice.navigating = true;
        continue;
      }
      const guidOfLocation = state.locations.get(guid);
      if (!refreshAll && voice.location === guidOfLocation && !voice.navigating) continue;
      voice.location = guidOfLocation;
      voice.navigating = false;
      const location = this.project.get(guidOfLocation);
      const scene = this.project.owner(location, 'Scene');
      let event = this.local.get(componentPath(this.project, location)) ??
        this.local.get(componentPath(this.project, scene));
      if (event?.attrs.loop === 'false') {
        const id = eventId(event);
        if (this.played.has(id)) event = null;
        else this.played.add(id);
      }
      this.schedule(voice, event, now);
    }
    let ambientChanged = false;
    for (const { sequence, milestones } of this.sequences) {
      let active;
      for (const milestone of milestones) {
        if (!milestone.predicate || state.isSatisfied(milestone.predicate) === true) active = milestone;
      }
      const previous = this.activeMilestones.get(sequence);
      if (active === previous) continue;
      if (active) this.activeMilestones.set(sequence, active);
      else this.activeMilestones.delete(sequence);
      ambientChanged ||= this.ambientMilestones.has(previous?.path) || this.ambientMilestones.has(active?.path);
      const cue = this.firstActiveCue();
      if (!cue || this.played.has(eventId(cue))) continue;
      this.played.add(eventId(cue));
      this.schedule(this.voice(FOREGROUND), cue, now);
    }
    for (const voice of this.voices.values()) this.startDue(voice, now);
    return ambientChanged;
  }

  isMilestoneActive(path) {
    return Array.from(this.activeMilestones.values()).some(milestone => milestone.path === path);
  }

  firstActiveCue() {
    for (const active of this.activeMilestones.values()) {
      const cue = this.cues.get(active.path);
      if (cue) return cue;
    }
    return null;
  }

  voice(key) {
    let voice = this.voices.get(key);
    if (voice) return voice;
    if (key !== FOREGROUND && this.voices.size - Number(this.voices.has(FOREGROUND)) >= LOCAL_LAYER_COUNT) return null;
    voice = { key, location: null, navigating: false, current: null, pending: null };
    this.voices.set(key, voice);
    return voice;
  }

  schedule(voice, event, now) {
    const next = settings(event);
    const { current, pending } = voice;
    const matches = entry => entry && entry.clipKey === next.clipKey && entry.volume === next.volume;
    if (matches(current) || matches(pending)) return;
    if (!next.clipKey && !current && !pending) return;
    let delay = next.delay;
    if (!next.interrupt && current?.clipKey && current.clipKey !== next.clipKey && current.duration > 0) {
      const elapsed = Math.max(0, now - current.startedAt);
      const remaining = current.loop ? current.duration - elapsed % current.duration : current.duration - elapsed;
      delay = Math.max(delay, Math.max(0, remaining));
    }
    const request = { ...next, due: now + delay, buffer: null, starting: false };
    voice.pending = request;
    if (request.clipKey) {
      this.bank.load(request.clipKey).then(({ buffer }) => {
        request.buffer = buffer;
        if (this.bank.context.state === 'running') this.startDue(voice, this.bank.context.currentTime);
      }).catch(error => this.fail(voice, request, error));
    }
  }

  fail(voice, request, error) {
    if (this.voices.get(voice.key) !== voice || voice.pending !== request) return;
    voice.pending = null;
    console.warn('配乐未播放', error);
  }

  startDue(voice, now) {
    const request = voice.pending;
    const valid = () => this.voices.get(voice.key) === voice && voice.pending === request;
    if (!request || !valid() || request.starting || now < request.due) return;
    const previous = voice.current;
    if (!request.clipKey) {
      voice.pending = null;
      voice.current = null;
      this.fadeOut(previous?.handle, request.fade);
      return;
    }
    if (!request.buffer) return;
    const gain = trackGain(request.volume);
    if (previous?.clipKey === request.clipKey) {
      this.ramp(previous.handle, gain, request.pan, request.fade);
      previous.volume = request.volume;
      voice.pending = null;
      return;
    }
    request.starting = true;
    const track = { ...request, duration: request.buffer.duration };
    this.bank.play(request.clipKey, {
      channel: 'music',
      volume: request.fade ? 0 : gain,
      pan: request.pan,
      loop: request.loop,
      shouldPlay: valid,
      onEnd: () => {
        if (voice.current === track) voice.current = null;
      },
    }).then(handle => {
      if (!handle) return;
      if (!valid()) {
        handle.stop();
        return;
      }
      this.fadeOut(voice.current?.handle, request.fade);
      voice.pending = null;
      track.handle = handle;
      track.startedAt = handle.startedAt ?? this.bank.context.currentTime;
      voice.current = track;
      if (request.fade) this.ramp(handle, gain, request.pan, request.fade);
    }).catch(error => this.fail(voice, request, error));
  }
}
