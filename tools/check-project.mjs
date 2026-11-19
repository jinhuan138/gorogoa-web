import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ProjectModel, loadProject } from "../src/engine/project.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) =>
  JSON.parse(
    fs
      .readFileSync(path.join(root, "public/assets/data", file), "utf8")
      .replace(/^\uFEFF/, ""),
  );
const node = (type, attrs = {}, children = []) => ({ type, attrs, children });
const leftLeaf = node("StateFlag", {
  guid: "shared",
  value: "0.4000000059604645",
});
const rightLeaf = node("StateFlag", { guid: "shared" });
const left = node("Card", { guid: "left" }, [node("states", {}, [leftLeaf])]);
const right = node("Card", { guid: "right" }, [
  node("states", {}, [rightLeaf]),
]);
const literal = { ...node("#text"), text: "保留文字 < & 0.4000000059604645" };
const tree = node("project", {}, [left, right, node("string", {}, [literal])]);
const fixture = new ProjectModel(tree);
assert.equal(fixture.tree, tree);
assert.equal(fixture.get("left"), left);
assert.equal(fixture.get("shared"), undefined);
assert.equal(fixture.byGuid.has("shared"), false);
assert.equal(fixture.get("shared", left), leftLeaf);
assert.equal(fixture.get("shared", right), rightLeaf);
assert.equal(fixture.get("shared", tree), undefined);
assert.equal(fixture.getAll("shared").length, 2);
assert.equal(fixture.duplicates.get("shared").length, 2);
assert.equal(fixture.owner(leftLeaf, "Card"), left);
assert.equal(fixture.owner(left, "Card"), undefined);
assert.deepEqual(fixture.container(left, "states", "StateFlag"), [leftLeaf]);
assert.deepEqual(fixture.direct(tree, "Card"), [left, right]);
assert.equal(fixture.text(tree.children[2]), literal.text);
assert.equal(leftLeaf.attrs.value, "0.4000000059604645");
assert.equal(fixture.parent.get(tree), null);
const cycle = node("project");
cycle.children.push(cycle);
assert.throws(() => new ProjectModel(cycle), /循环/);
assert.throws(() => new ProjectModel({ type: "project" }), /节点/);

const projectTree = read("runtime-project.json");
const chapter1Save = read("runtime-chapter1-save.json");
const manifest = read("runtime-manifest.json");
assert.equal(manifest.saveKind, "chapterCheckpoint");
for (const result of [manifest.project, manifest.chapter1Save]) {
  const bytes = fs.readFileSync(path.join(root, "public", result.outputFile));
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    result.outputSha256,
  );
  const original = fs.readFileSync(path.join(root, result.sourceFile));
  assert.equal(
    crypto.createHash("sha256").update(original).digest("hex"),
    result.sourceSha256,
  );
}
const project = new ProjectModel(projectTree);
const save = new ProjectModel(chapter1Save);
assert.equal(project.all("Card").length, 25);
assert.equal(project.all("SceneLocation").length, 452);
assert.equal(project.all("StateTransition").length, 1244);
assert.equal(project.all("MotionKeyframes").length, 625);
assert.equal(project.all("fieldModificationLog").length, 0);
let totalNodes = 0;
for (const nodes of project.nodesByType.values())
  for (const item of nodes) {
    totalNodes++;
    assert.equal(Object.hasOwn(item.attrs, "lastModified"), false);
    assert.equal(Object.hasOwn(item.attrs, "lastModifiedByUser"), false);
    for (const value of Object.values(item.attrs))
      assert.equal(typeof value, "string");
  }
const namedImage = project
  .all("ImageLayer")
  .find(
    (item) =>
      item.attrs.name === "LAYER_SCANS" &&
      item.attrs.inputFilename?.includes("clock_Ltower"),
  );
assert.equal(namedImage?.type, "ImageLayer", "XML name 属性不能覆盖真实标签");
const startingCard = project.get(project.tree.attrs.staringCard);
assert.equal(startingCard?.type, "Card");
assert.equal(
  project.get(startingCard.attrs.startingLocation, startingCard)?.type,
  "SceneLocation",
);
assert.equal(chapter1Save.attrs.storyPhase, "CHAPTERS");
assert.equal(chapter1Save.attrs.time, "3600");
assert.equal(chapter1Save.attrs.clicks, "1000");
assert.equal(project.get(chapter1Save.attrs.selectedCardGUID)?.type, "Card");
assert.equal(save.all("CardSaveData").length, 25);
let stateReferences = 0;
for (const item of save.all("CardSaveData")) {
  const card = project.get(item.attrs.cardGUID);
  assert.equal(card?.type, "Card");
  const location = project.get(item.attrs.locationGUID, card);
  assert.equal(location?.type, "SceneLocation", item.attrs.locationGUID);
  const entries = save
    .container(item, "stateGUIDMap")
    .flatMap((map) => save.direct(map, "entry"));
  for (const entry of entries) {
    assert.ok(
      project.get(entry.attrs.key, card),
      `状态所属对象：${entry.attrs.key}`,
    );
    assert.equal(
      project.get(entry.attrs.value, card)?.type,
      "StateFlag",
      entry.attrs.value,
    );
    stateReferences++;
  }
}
const originalFetch = globalThis.fetch;
const requested = [];
try {
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return {
      ok: true,
      json: async () =>
        String(url).endsWith("runtime-project.json")
          ? projectTree
          : chapter1Save,
    };
  };
  const loaded = await loadProject("https://example.invalid/gorogoa/");
  assert.equal(loaded.project.all("Card").length, 25);
  assert.equal(loaded.chapter1Save, chapter1Save);
  assert.deepEqual(requested, [
    "https://example.invalid/gorogoa/assets/data/runtime-project.json",
    "https://example.invalid/gorogoa/assets/data/runtime-chapter1-save.json",
  ]);
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadProject("https://example.invalid/gorogoa/"), /404/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  JSON.stringify({
    result: "项目树与章节存档检查通过",
    totalNodes,
    guids: project.byGuidAll.size,
    duplicateGuids: project.duplicates.size,
    cards: project.all("Card").length,
    locations: project.all("SceneLocation").length,
    chapterCards: save.all("CardSaveData").length,
    stateReferences,
    checkpointOnly: true,
  }),
);
