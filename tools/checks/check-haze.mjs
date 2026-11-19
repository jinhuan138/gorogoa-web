import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectModel } from "../../src/engine/model/project.js";
import { SceneRenderer } from "../../src/engine/render/renderer.js";
import {
  hazeColor,
  accumulateHaze,
  hazeDrawList,
  paintHaze,
} from "../../src/engine/render/effects.js";
const read = (f) =>
  JSON.parse(
    fs
      .readFileSync(
        new URL("../../public/assets/" + f, import.meta.url),
        "utf8",
      )
      .replace(/^\uFEFF/, ""),
  );
assert.deepEqual(
  hazeColor({ hazeColor: "-1", hazeAmount: "0.5" }),
  [1, 1, 1, 0.5],
);
assert.deepEqual(
  hazeColor({ hazeColor: "-16777216", hazeAmount: "1" }),
  [0, 0, 0, 1],
);
assert.deepEqual(
  accumulateHaze([1, 0, 0, 0.5], [0, 0, 1, 0.5]),
  [0.5, 0, 0.5, 0.75],
);
const children = [{}],
  caster = [{}],
  list = [{ children, caster }];
hazeDrawList(list, [1, 1, 1, 0.5], true);
assert.deepEqual(children[0].haze, [1, 1, 1, 0.5]);
assert.equal(
  caster[0].haze,
  undefined,
  "原版图层雾化只递归 children，不修改 shadowCaster",
);
const operations = [],
  ctx = {
    save() {},
    restore() {},
    fillRect(...args) {
      operations.push({
        mode: this.globalCompositeOperation,
        alpha: this.globalAlpha,
        color: this.fillStyle,
        args,
      });
    },
  };
paintHaze(ctx, [1, 0.5, 0, 0.25], 350, 350);
assert.deepEqual(operations, [
  {
    mode: "source-atop",
    alpha: 0.25,
    color: "rgb(255,127.5,0)",
    args: [0, 0, 350, 350],
  },
]);
const p = new ProjectModel(read("data/runtime-project.json")),
  r = new SceneRenderer(p, read("manifest.json"), read("data/atlases.json"), {
    isSatisfied: () => true,
    holeContent: () => ({ sealed: true }),
  }),
  start = p.get(p.get(p.tree.attrs.staringCard).attrs.startingLocation),
  report = r.buildDrawList(start.attrs.guid, { timeSeconds: 4 });
assert.ok(report.drawn.some((item) => item.haze?.[3] > 0));
assert.ok(!report.unsupported.some((item) => item.reason.includes("雾化")));
console.log(
  JSON.stringify({
    result:
      "原版ARGB颜色、非归一化雾化累积、children递归与shader等效RGB插值通过",
    hazed: report.drawn.filter((item) => item.haze?.[3] > 0).length,
  }),
);
