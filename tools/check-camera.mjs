import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectModel } from "../src/engine/project.js";
import {
  Camera,
  CARD_SIZE,
  CAMERA_FOV,
  identity4,
  multiply4,
  invert4,
  point3,
  resolveViewpoint,
  parallaxTransform,
} from "../src/engine/camera.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = new ProjectModel(
  JSON.parse(
    fs.readFileSync(
      path.join(root, "public/assets/data/runtime-project.json"),
      "utf8",
    ),
  ),
);
const close = (a, b, t = 1e-7) => {
  assert.equal(a.length, b.length);
  a.forEach((x, i) =>
    assert.ok(Math.abs(x - b[i]) < t, `${i}: ${x} != ${b[i]}`),
  );
};
const transform = [0, -2, 0, 3, 2, 0, 0, -5, 0, 0, 2, 7, 0, 0, 0, 1];
close(multiply4(transform, invert4(transform)), identity4());
close(point3(invert4(transform), point3(transform, [2, 4, -8])), [2, 4, -8]);
assert.throws(() => invert4(Array(16).fill(0)), /不可逆/);
const camera = new Camera();
const viewport = [-1, -1, 2, 2];
close(camera.globalToDisplay([0, 0, -2], viewport), [175, 175, 2]);
close(
  camera.globalToDisplay(
    [2 * Math.tan(CAMERA_FOV), 2 * Math.tan(CAMERA_FOV), -2],
    viewport,
  ),
  [350, 0, 2],
);
assert.ok(Number.isNaN(camera.globalToDisplay([0, 0, 1], viewport)[0]));
close(
  parallaxTransform({ camera, viewport }, { camera, viewport }, [0, 0, -2]),
  [1, 0, 0, 1, 0, 0],
);
const start = p.get(p.get(p.tree.attrs.staringCard).attrs.startingLocation),
  view = resolveViewpoint(p, start);
const interpolated = p.container(start, "viewpoint")[0],
  from = resolveViewpoint(p, p.get(interpolated.attrs.fromLocation)),
  to = resolveViewpoint(p, p.get(interpolated.attrs.toLocation)),
  f = Number(interpolated.attrs.interpFraction);
close(
  view.camera.position,
  from.camera.position.map((v, i) => v + (to.camera.position[i] - v) * f),
);
for (let i = 0; i < 16; i++)
  if (![3, 7, 11].includes(i))
    assert.equal(view.camera.matrix[i], from.camera.matrix[i]);
close(
  view.viewport,
  from.viewport.map((v, i) => v + (to.viewport[i] - v) * f),
);
const syntheticOffset = {
  type: "OffsetViewpoint",
  attrs: {
    fromLocation: start.attrs.guid,
    offset: "0,0,0",
    viewportOffset: "0.1,-0.2",
    viewportScale: "0.8",
  },
  children: [],
};
const offsetView = resolveViewpoint(p, syntheticOffset);
close(offsetView.viewport, [
  view.viewport[0] + 0.2,
  view.viewport[1] - 0.1,
  view.viewport[2] - 0.2,
  view.viewport[3] - 0.2,
]);
let resolved = 0;
const unavailable = [];
for (const loc of p.all("SceneLocation"))
  try {
    const result = resolveViewpoint(p, loc);
    close(
      multiply4(result.camera.matrix, result.camera.inverse),
      identity4(),
      1e-5,
    );
    assert.ok(result.viewport.every(Number.isFinite));
    assert.ok(result.viewport[2] > 0 && result.viewport[3] > 0);
    resolved++;
  } catch (error) {
    unavailable.push({
      guid: loc.attrs.guid,
      id: loc.attrs.id,
      reason: error.message,
    });
  }
assert.ok(resolved > 400);
assert.equal(CARD_SIZE, 350);
console.log(
  JSON.stringify({
    result: "相机、投影、矩阵逆、同相机视差、插值语义检查通过",
    resolved,
    unavailable,
  }),
);
