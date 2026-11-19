import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectModel } from "../../src/engine/model/project.js";
import {
  AnimationSampler,
  interpFraction,
  angleLerp,
  rangeFraction,
} from "../../src/engine/animation.js";
import { SceneRenderer } from "../../src/engine/render/renderer.js";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  read = (f) =>
    JSON.parse(
      fs
        .readFileSync(path.join(root, "public/assets", f), "utf8")
        .replace(/^\uFEFF/, ""),
    );
const project = new ProjectModel(read("data/runtime-project.json")),
  sampler = new AnimationSampler(project);
const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
near(rangeFraction(2, 2, 2), 0);
near(interpFraction("NONE", 0.3), 0.3);
near(interpFraction("SINE", 0.5), 0.5);
near(interpFraction("TO_SINE", 0.5), Math.SQRT1_2);
near(interpFraction("FROM_SINE", 0.5), 1 - Math.SQRT1_2);
near(interpFraction("REVERSE_FROM_SINE", 0.5), Math.SQRT1_2);
near(Math.sin(angleLerp((350 * Math.PI) / 180, (10 * Math.PI) / 180, 0.5)), 0);
near(Math.cos(angleLerp((350 * Math.PI) / 180, (10 * Math.PI) / 180, 0.5)), 1);
const arrival = project
  .all("PlayListGraphic")
  .find((node) => node.attrs.id === "sd_arrives");
assert.equal(sampler.durationMillis(arrival), 8000);
assert.equal(
  sampler.playlist(arrival, 0).length,
  0,
  "起始延迟前不绘制任何条目",
);
assert.equal(sampler.playlist(arrival, 0.124).length, 0);
const delayedStart = sampler.playlist(arrival, 0.125);
assert.equal(delayedStart.length, 3);
delayedStart.forEach((sample) => near(sample.fraction, 0));
const halfway = sampler.playlist(arrival, 0.5);
halfway.forEach((sample) => near(sample.fraction, 3 / 7));
const arrivalMotion = halfway.find(
  (sample) => sample.graphic.type === "MotionKeyframesGraphic",
).graphic;
const keyframes = project.container(arrivalMotion, "motionKeyframes");
assert.equal(keyframes.length, 10);
const eye = keyframes.find((node) => node.attrs.id === "EyeKF0");
const first = JSON.parse(JSON.stringify(eye));
const positions = sampler.channel(first, "positionByKeyframe");
assert.ok(positions.length > 10);
for (let i = 1; i < positions.length; i++)
  assert.ok(positions[i].time >= positions[i - 1].time);
const a = positions[0],
  b = positions[1],
  time = (a.time + b.time) / 2,
  value = sampler.sampleFrame(first, "positionByKeyframe", time);
value.forEach((v, i) => near(v, (a.value[i] + b.value[i]) / 2));
const motionParts = sampler.motionParts(arrivalMotion, 0.5);
assert.equal(motionParts.length, 10);
motionParts.forEach((part) => {
  assert.ok(part.matrix.every(Number.isFinite));
  assert.ok(part.cutout?.every(Number.isFinite));
});
const waits = project
  .all("PlayListGraphic")
  .find((node) => node.attrs.id === "sd_waits");
assert.equal(sampler.durationMillis(waits), 0);
const held = sampler.playlist(waits, 0);
assert.equal(held.length, 1);
assert.equal(held[0].fraction, 1);
const entry = project.container(arrival, "entries")[1];
const wrapped = JSON.parse(JSON.stringify(entry));
wrapped.attrs.startFraction = "0";
wrapped.attrs.endFraction = "2";
wrapped.attrs.durationScale = "1";
wrapped.attrs.startDelayMillis = "0";
near(sampler.wrapped(wrapped, 1), 1);
near(sampler.wrapped(wrapped, 1.5), 0.5);
near(sampler.wrapped(wrapped, 2), 1);
const reverse = JSON.parse(JSON.stringify(entry));
reverse.attrs.startFraction = "1";
reverse.attrs.endFraction = "0";
reverse.attrs.startDelayMillis = "0";
near(sampler.entryFraction(reverse, 0), 1);
near(sampler.entryFraction(reverse, 1), 0);
const predicate = project.container(arrival, "predicate")[0],
  renderer = new SceneRenderer(
    project,
    read("manifest.json"),
    read("data/atlases.json"),
    { isSatisfied: (node) => node === predicate },
  );
const start = project.get(
  project.get(project.tree.attrs.staringCard).attrs.startingLocation,
);
const beginning = renderer.buildDrawList(start.attrs.guid, { timeSeconds: 0 });
const clock = beginning.animations.find(
  (item) => item.guid === arrival.attrs.guid,
);
assert.equal(clock.durationSeconds, 8);
assert.equal(clock.complete, false);
assert.equal(beginning.drawn.filter((item) => item.part).length, 0);
const moving = renderer.buildDrawList(start.attrs.guid, { timeSeconds: 4 });
assert.equal(moving.drawn.filter((item) => item.part).length, 10);
assert.equal(moving.missing.length, 0);
for (const item of moving.drawn) {
  assert.ok(item.matrix.every(Number.isFinite));
  assert.ok(item.dest.every(Number.isFinite));
}
const finished = renderer.buildDrawList(start.attrs.guid, { timeSeconds: 8 });
assert.equal(
  finished.animations.find((item) => item.guid === arrival.attrs.guid).complete,
  true,
);
const reset = renderer.buildDrawList(start.attrs.guid, {
  timeSeconds: 8,
  graphicTimes: new Map([[arrival.attrs.guid, 8]]),
});
assert.equal(
  reset.animations.find((item) => item.guid === arrival.attrs.guid)
    .elapsedSeconds,
  0,
);
assert.equal(reset.drawn.filter((item) => item.part).length, 0);
console.log(
  JSON.stringify({
    result: "原版播放列表、关键帧、延迟、裁切、翻向与激活时钟检查通过",
    arrivalMillis: sampler.durationMillis(arrival),
    arrivalParts: motionParts.length,
    drawnAtFourSeconds: moving.drawn.length,
    missing: moving.missing.length,
    unsupported: moving.unsupported.map((item) => item.type),
  }),
);
