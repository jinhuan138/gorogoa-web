import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectModel } from "../src/engine/project.js";
import { AudioBank } from "../src/engine/audio.js";
import { trackGain } from "../src/engine/score.js";

const publicUrl = new URL("../public/", import.meta.url);
const read = (path) =>
  JSON.parse(
    fs.readFileSync(new URL(path, publicUrl), "utf8").replace(/^\uFEFF/, ""),
  );
const project = new ProjectModel(read("assets/data/runtime-project.json"));
const manifest = read("assets/audio/manifest.json");
const eventManifest = read("assets/audio/events.json");
const clips = new Map(manifest.clips.map((clip) => [clip.key, clip]));
const events = eventManifest.events;

function componentPath(node) {
  const ids = [];
  for (
    let item = node;
    item && item !== project.tree;
    item = project.parent.get(item)
  ) {
    if (item.attrs.id) ids.push(item.attrs.id);
  }
  return ids.reverse().join("/");
}

function ambient(guid) {
  const path = componentPath(project.get(guid));
  return events
    .filter((event) => !event.attrs.type && event.attrs.locPath === path)
    .map((event) => [
      event.attrs.layer,
      event.clipName,
      Number(event.attrs.volume),
      Number(event.attrs.pan),
    ]);
}

function verifyAnimation(guid, expected) {
  const graphic = project.get(guid);
  assert.equal(graphic.attrs.soundtrackEnabled, "true", guid);
  const matches = events.filter(
    (event) =>
      event.attrs.anim === componentPath(graphic) && event.attrs.type === "sfx",
  );
  assert.equal(matches.length, 1, guid);
  const { clipName, attrs } = matches[0];
  assert.deepEqual(
    [
      clipName,
      Number(attrs.volume),
      Number(attrs.pan),
      Number(attrs.startDelay || 0),
    ],
    expected,
    guid,
  );
}

assert.equal(manifest.failures.length, 0);
assert.equal(clips.size, 291);
assert.equal(manifest.clips.length, clips.size);
assert.equal(eventManifest.sources.length, 9);
assert.equal(events.length, 755);
assert.deepEqual(eventManifest.missingEventClips, []);

assert.equal(trackGain(0), 0);
assert.equal(trackGain(1), 1);
assert.ok(
  Math.abs(trackGain(0.3) - 100 / 904) < 1e-7,
  "原版城市环境音保留取整后的增益",
);
assert.ok(
  Math.abs(trackGain(0.5) - 100 / 416) < 1e-7,
  "原版场景音乐保留取整后的增益",
);

const destination = {};
const makeAudioNode = () => ({
  gain: {
    value: 1,
    setTargetAtTime(value) {
      this.value = value;
    },
  },
  playbackRate: { value: 1 },
  connect(output) {
    this.output = output;
  },
  start() {},
});
const bank = new AudioBank({
  currentTime: 0,
  destination,
  decodeAudioData() {},
  createGain: makeAudioNode,
  createBufferSource: makeAudioNode,
});
bank.load = async () => ({ clip: {}, buffer: {} });
bank.setChannelVolume("music", 0.25);
bank.setChannelVolume("effects", 0.7);
const music = await bank.play("score", { channel: "music" });
const effect = await bank.play("sound");
assert.equal(music.gain.output.gain.value, 0.25);
assert.equal(effect.gain.output.gain.value, 0.7);
assert.equal(music.gain.output.output, destination);
assert.equal(effect.gain.output.output, destination);
bank.setChannelVolume("effects", 0);
assert.equal(effect.gain.output.gain.value, 0);
assert.equal(music.gain.output.gain.value, 0.25);

for (const clip of clips.values()) {
  const fd = fs.openSync(new URL(clip.url, publicUrl), "r");
  try {
    const identity = Buffer.alloc(58);
    assert.equal(fs.readSync(fd, identity), identity.length, clip.key);
    assert.equal(identity.toString("ascii", 0, 4), "OggS", clip.key);
    assert.equal(identity[28], 1, clip.key);
    assert.equal(identity.toString("ascii", 29, 35), "vorbis", clip.key);
    assert.equal(identity[39], clip.channels, clip.key);
    assert.equal(identity.readUInt32LE(40), clip.frequency, clip.key);
    assert.equal(
      clip.samples / clip.frequency,
      clip.durationExpected,
      clip.key,
    );
  } finally {
    fs.closeSync(fd);
  }
}

for (const event of events) {
  if (event.attrs.soundFile) {
    const basename = event.attrs.soundFile
      .split(/[\\/]/)
      .at(-1)
      .replace(/\.[^.]+$/, "");
    assert.equal(event.clipName.toLowerCase(), basename.toLowerCase());
    assert.equal(clips.get(event.clipKey)?.name, event.clipName);
  } else {
    assert.equal(event.clipKey, null);
  }
}

const opening = "city1a000-51e93555-9ab5-4fee-9f1d-224a72aa70fa";
const city = "city1a-e2cc1b58-b06d-4371-b9cb-0f953719a06b";
const window = "window-fec0e0e5-9948-45c0-a43a-26d01d59cd0c";
const balloon = "balloon-24911816-b34c-4ca2-ac77-3dd210ee6b92";
assert.deepEqual(ambient(opening), [
  ["City_Opening", "Amb_Chapter1_City_Opening", 0.3, 0.5],
  ["City_Rooftop_A", "Amb_Chapter1_City_Busy_02", 0.2, 0.5],
]);
assert.deepEqual(ambient(city), [
  ["City_Opening", "Amb_Chapter1_City_Opening", 0.3, 0.5],
  ["City_Rooftop_A", "Amb_Chapter1_City_Busy_02", 0.3, 0.5],
]);
assert.deepEqual(ambient(window), [
  ["Apt_RoomTone", "Amb_Chapter1_Apt_RoomTone", 0.3, 0.5],
  ["City_Opening", "Amb_Chapter1_City_Opening", 0.2, 0.5],
  ["Apt_Clock", "Amb_Chapter1_Apt_WallClock", 0.25, 0.8],
]);
assert.deepEqual(ambient(balloon), [
  ["Apt_RoomTone", "Amb_Chapter1_Apt_RoomTone", 0.2, 0.5],
  ["City_Opening", "Amb_Chapter1_City_Opening", 0.14, 0.5],
  ["Apt_Clock", "Amb_Chapter1_Apt_WallClock", 0.17, 0.9],
]);

verifyAnimation("sd_arrives-9e3d0e56-b678-427d-bd17-ad115a81a23c", [
  "Ani_Chapter1_Gorogoa_Sighting",
  0.8,
  0.5,
  1,
]);
verifyAnimation("arrive_full-bdec2aee-56af-4600-9f46-807b18fa814a", [
  "Ani_Chapter1_Boy_ComingToWindow",
  0.55,
  0.5,
  0,
]);
verifyAnimation("leave-68e2c54b-0391-4eb7-82a9-2ec0aa4698f5", [
  "Ani_Chapter1_Boy_LeavingWindow",
  0.5,
  0.5,
  1.6,
]);
verifyAnimation("research2-0c207244-623d-40b7-9066-3dd68972d850", [
  "Ani_Chapter3_Boy_FlipPages_01",
  0.3,
  0.5,
  1.2,
]);
verifyAnimation("research3-a3bdab0d-46d6-47b7-8e74-3e075172ec0e", [
  "Ani_Chapter3_Boy_FlipPages_02",
  0.3,
  0.5,
  1.1,
]);
verifyAnimation("flip_3_pages-84baa73c-98e0-4224-8d85-7e35d10f5270", [
  "Ani_Chapter3_Boy_FlipPages",
  0.25,
  0.5,
  1,
]);
verifyAnimation("flip_pages-5853a7c6-8775-4cf6-90c0-b8c173f812d2", [
  "Ani_Finale_Boy_BookPages",
  0.4,
  0.5,
  1.9,
]);

const transitionPaths = new Set(
  project.all("LocationTransition").map(componentPath),
);
assert.deepEqual(
  events.filter((event) => transitionPaths.has(event.attrs.locPath)),
  [],
);
for (const [guid, destination, duration, legacyName] of [
  [
    "back to city1a-ab580269-ba28-48db-9dda-5e5260988d31",
    window,
    2000,
    "FX_Transition_IntoApt",
  ],
  [
    "to balloon-33cafc2d-cfb6-4ae1-8b14-91be315cd25b",
    balloon,
    800,
    "FX_Transition_IntoBook_01",
  ],
]) {
  const transition = project.get(guid);
  const [entry] = project.container(
    transition,
    "ambientSoundEntries",
    "SoundSequenceEntry",
  );
  const legacy = project.get(entry.attrs.soundClip);
  assert.equal(transition.attrs.destLocation, destination);
  assert.equal(Number(transition.attrs.transitionDuration), duration);
  assert.ok(legacy.attrs.animationFilename.endsWith(legacyName + ".wav"));
  assert.ok(!manifest.clips.some((clip) => clip.name === legacyName));
}

for (const [type, prefix, count] of [
  ["int_lift_card", "UI_Card_PickUp", 17],
  ["int_drop_card", "UI_Card_Place", 14],
]) {
  const matches = events.filter((event) => event.attrs.type === type);
  assert.equal(matches.length, count);
  matches.forEach((event, index) => {
    assert.equal(
      event.clipName,
      `${prefix}_${String(index + 1).padStart(2, "0")}`,
    );
    assert.deepEqual([event.attrs.volume, event.attrs.pan], ["1", "0.5"]);
  });
}

console.log(
  JSON.stringify({
    result: "正式声音事件、开场室内图层、翻书动画及转场目标检查通过",
    clips: clips.size,
    events: events.length,
  }),
);
