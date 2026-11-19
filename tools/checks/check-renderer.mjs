import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectModel } from "../../src/engine/model/project.js";
import { SceneRenderer } from "../../src/engine/render/renderer.js";
import { normalizeSource } from "../../src/engine/render/atlas.js";
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
const p = new ProjectModel(read("data/runtime-project.json")),
  manifest = read("manifest.json"),
  atlases = read("data/atlases.json");
const r = new SceneRenderer(p, manifest, atlases),
  start = p.get(p.get(p.tree.attrs.staringCard).attrs.startingLocation),
  report = r.buildDrawList(start.attrs.guid);
assert.equal(report.missing.length, 0);
assert.equal(report.locations.length, 4);
assert.equal(new Set(report.locations).size, 4);
assert.ok(report.drawn.length >= 10);
assert.equal(report.drawn[0].source, "final/card002/city2/sky1");
assert.deepEqual(report.drawn[0].matrix, [1, 0, 0, 1, 0, 0]);
assert.equal(
  normalizeSource("C:\\Users\\Jake\\assets\\final\\card002\\city2\\sky1.png"),
  "final/card002/city2/sky1",
);
for (const item of report.drawn) {
  assert.ok(item.matrix.every(Number.isFinite));
  assert.ok(item.dest.every(Number.isFinite));
  assert.ok(item.dest[2] > 0 && item.dest[3] > 0);
  assert.ok(fs.existsSync(path.join(root, "public", item.region.textureUrl)));
  assert.ok(item.alpha >= 0 && item.alpha <= 1);
}
for (let i = 1; i < report.layers.length; i++)
  assert.ok(report.layers[i - 1].depth >= report.layers[i].depth);
assert.ok(report.unsupported.some((item) => item.reason === "谓词语义未实现"));
const cycleBefore = start.attrs.backgroundLocation;
start.attrs.backgroundLocation = start.attrs.guid;
assert.ok(
  r
    .buildDrawList(start.attrs.guid)
    .unsupported.some((item) => item.reason.includes("循环")),
);
start.attrs.backgroundLocation = cycleBefore;
const n = (type, attrs = {}, children = []) => ({ type, attrs, children });
function fixture(hasStates) {
  const picture = n("LayeredImageGraphic", { guid: "pic" }, [
    n("layeredImage", {}, [
      n("LayeredImage", {}, [
        n("imageLayers", {}, [
          n("ImageLayer", { inputFilename: "final/test.png" }),
        ]),
      ]),
    ]),
  ]);
  const layer = n("LocationLayer", { guid: "ll", sceneLayer: "sl" }, [
    n("graphics", {}, [picture]),
  ]);
  const view = n("StandardViewpoint", {
    camera: "1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1",
    viewport: "-1,-1,2,2",
  });
  const location = n(
    "SceneLocation",
    { guid: "loc", marginsRegion: "0,0,1,1" },
    [n("viewpoint", {}, [view]), n("sceneLocationLayers", {}, [layer])],
  );
  const states = hasStates
    ? [n("states", {}, [n("StateFlag", { guid: "state" })])]
    : [];
  const scene = n("Scene", { guid: "scene" }, [
    n("sceneLayers", {}, [
      n("SceneLayer", { guid: "sl", refPoint: "0,0,-2" }, states),
    ]),
    n("sceneLocations", {}, [location]),
  ]);
  return new ProjectModel(
    n("project", {}, [n("Card", { guid: "card" }, [n("scenes", {}, [scene])])]),
  );
}
const fm = { textures: [{ key: "sheet", height: 8 }] },
  fa = {
    entries: [
      {
        source: "final/test",
        textureKey: "sheet",
        textureUrl: "test.png",
        u: 0,
        v: 0,
        w: 8,
        h: 8,
        offsetX: 0,
        offsetY: 0,
        originalW: 8,
        originalH: 8,
      },
    ],
  };
const f0 = new SceneRenderer(fixture(false), fm, fa),
  f1 = new SceneRenderer(fixture(true), fm, fa);
assert.equal(f0.buildDrawList("loc").drawn.length, 1);
assert.equal(
  f1.buildDrawList("loc").drawn.length,
  0,
  "有状态图层的无谓词辅助图不能直接激活",
);
const transitionTree = structuredClone(fixture(false).tree),
  scene = transitionTree.children[0].children[0].children[0],
  locations = scene.children.find((node) => node.type === "sceneLocations");
const second = structuredClone(locations.children[0]);
second.attrs.guid = "loc2";
second.children.find(
  (node) => node.type === "sceneLocationLayers",
).children[0].attrs.guid = "ll2";
second.children.find(
  (node) => node.type === "sceneLocationLayers",
).children[0].children[0].children[0].attrs.guid = "pic2";
locations.children.push(second);
const transitionProject = new ProjectModel(transitionTree),
  transitionRenderer = new SceneRenderer(transitionProject, fm, fa);
assert.equal(
  transitionRenderer.buildDrawList("loc", {
    transitionLocations: [
      transitionProject.get("loc"),
      transitionProject.get("loc2"),
    ],
  }).drawn[0].guid,
  "pic2",
  "同距离按原版选择后出现的场景候选，须在同一 byLayer 中混合",
);
assert.deepEqual(
  transitionRenderer
    .buildDrawList("loc", { transitionLocations: ["loc", "loc2"] })
    .drawn.map((item) => item.guid),
  ["pic2", "pic"],
  "同视口的横向混合保留两项，但共同按原版候选顺序选择",
);
const sourceRectImage = p
  .all("ImageLayer")
  .find((node) => node.attrs.sourceRect);
assert.ok(sourceRectImage.attrs.inputFilename.includes("roof00_Lfkiosk_HOLE"));
const croppedProject = fixture(false),
  croppedNode = croppedProject.all("ImageLayer")[0];
croppedNode.attrs = { ...sourceRectImage.attrs };
const croppedRenderer = new SceneRenderer(croppedProject, manifest, atlases),
  croppedResult = croppedRenderer.buildDrawList("loc");
assert.equal(croppedResult.missing.length, 0);
assert.equal(croppedResult.drawn.length, 1);
const cropped = croppedResult.drawn[0],
  rect = sourceRectImage.attrs.sourceRect.split(",").map(Number);
const virtual =
  sourceRectImage.attrs.sourceRectIsProportional === "true"
    ? rect.map(
        (v, i) =>
          v *
          (i % 2 === 0 ? cropped.region.originalW : cropped.region.originalH),
      )
    : rect;
const virtualY = cropped.region.originalH - virtual[1] - virtual[3];
const cilDestY =
  ((virtual[3] - cropped.region.offsetY - cropped.region.h + virtualY) /
    virtual[3]) *
  350;
assert.ok(
  Math.abs(cropped.dest[1] - cilDestY) < 1e-9,
  "GetUIImage纵坐标转换后再代入GetGraphic应保持原版虚拟裁切",
);
let draws = 0;
f0.atlas.image = async () => ({});
const ctx = {
  globalAlpha: 1,
  save() {},
  restore() {},
  beginPath() {},
  rect() {},
  clip() {},
  transform(...values) {
    assert.equal(values.length, 6);
  },
  drawImage(...values) {
    assert.equal(values.length, 9);
    draws++;
  },
};
await f0.render(ctx, "loc");
assert.equal(draws, 1);
console.log(
  JSON.stringify({
    result: "场景背景链、图层顺序、静态图片引用和辅助图筛选检查通过",
    drawn: report.drawn.length,
    visibleLocations: report.locations.length,
    unsupported: report.unsupported.length,
    missing: report.missing.length,
  }),
);
