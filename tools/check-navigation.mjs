import fs from "node:fs";
import assert from "node:assert/strict";
import { ProjectModel } from "../src/engine/project.js";
import {
  buttonRegion,
  hotspotRegion,
  planTransition,
  sampleTransition,
} from "../src/engine/navigation.js";
import { CARD_SIZE } from "../src/engine/camera.js";
const project = new ProjectModel(
  JSON.parse(
    fs
      .readFileSync(
        new URL("../public/assets/data/runtime-project.json", import.meta.url),
        "utf8",
      )
      .replace(/^\uFEFF/, ""),
  ),
);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const size = 40 / 350;
assert.equal(CARD_SIZE, 350);
assert.deepEqual(buttonRegion("NORTHWEST"), [0.05, 0.05, size, size]);
const sw = buttonRegion("SOUTHWEST");
near(sw[0], 0.05);
near(sw[1], 1 - 0.05 - size);
near(sw[2] * 350, 40);
near(buttonRegion("NORTH")[0], 0.5 - size / 2);
const intro = project.get(
    "back to city1a-ab580269-ba28-48db-9dda-5e5260988d31",
  ),
  introPlan = planTransition(project, intro);
assert.deepEqual(hotspotRegion(intro), sw);
assert.equal(introPlan.durationSeconds, 2);
assert.equal(
  introPlan.fromLocation.attrs.guid,
  "city1a000-51e93555-9ab5-4fee-9f1d-224a72aa70fa",
);
assert.equal(
  introPlan.toLocation.attrs.guid,
  "city1a-e2cc1b58-b06d-4371-b9cb-0f953719a06b",
);
const a = sampleTransition(introPlan, 0),
  b = sampleTransition(introPlan, 1),
  c = sampleTransition(introPlan, 2);
near(b.fraction, 0.5);
assert.equal(a.complete, false);
assert.equal(c.complete, true);
a.viewpoint.camera.position.forEach((value, i) =>
  near(value, introPlan.from.camera.position[i]),
);
c.viewpoint.camera.position.forEach((value, i) =>
  near(value, introPlan.to.camera.position[i]),
);
let keyframed = 0,
  crossScene = 0,
  maxLocations = 0;
const unresolved = [];
const all = project.all("LocationTransition");
for (const transition of all) {
  let plan;
  try {
    plan = planTransition(project, transition);
  } catch (error) {
    assert.equal(
      project.get(transition.attrs.destLocation),
      undefined,
      "只允许保留已确认的原版缺失目标",
    );
    unresolved.push(transition.attrs.guid);
    continue;
  }
  if (
    project.owner(plan.fromLocation, "Scene") !==
    project.owner(plan.origin, "Scene")
  )
    crossScene++;
  maxLocations = Math.max(maxLocations, plan.locations.length);
  for (const time of [0, plan.durationSeconds / 2, plan.durationSeconds]) {
    const sample = sampleTransition(plan, time);
    assert.ok(
      sample.viewpoint.camera.matrix.every(Number.isFinite),
      transition.attrs.guid,
    );
    assert.ok(
      sample.viewpoint.viewport.every(Number.isFinite),
      transition.attrs.guid,
    );
    assert.equal(sample.locationGUIDs[0], plan.fromLocation.attrs.guid);
    assert.equal(sample.locationGUIDs.at(-1), plan.toLocation.attrs.guid);
  }
  if (transition.attrs.hotspotStyle === "REGION")
    assert.deepEqual(
      hotspotRegion(transition),
      transition.attrs.hotspotRegion.split(",").map(Number),
    );
  if (plan.keyframes.length) {
    keyframed++;
    assert.equal(
      plan.durationSeconds,
      Math.trunc(plan.keyframes.at(-1).time * 1000) / 1000,
    );
    assert.equal(sampleTransition(plan, 0).fraction, plan.reverse ? 1 : 0);
  }
}
assert.equal(unresolved.length, 8);
assert.equal(keyframed, 14);
assert.ok(maxLocations > 2);
console.log(
  JSON.stringify({
    result: "原版导航规划/中间位置/相机插值/按钮比例/反向关键帧检查通过",
    transitions: all.length,
    keyframed,
    crossScene,
    maxLocations,
    unresolvedTargets: unresolved,
  }),
);
