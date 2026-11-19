import fs from "node:fs";
import assert from "node:assert/strict";
import { ProjectModel } from "../src/engine/project.js";
import { RuntimeState } from "../src/engine/state.js";
import { LinkModel } from "../src/engine/links.js";
const read = (f) =>
  JSON.parse(
    fs
      .readFileSync(
        new URL(`../public/assets/data/${f}`, import.meta.url),
        "utf8",
      )
      .replace(/^\uFEFF/, ""),
  );
const p = new ProjectModel(read("runtime-project.json")),
  s = new RuntimeState(p),
  links = new LinkModel(p, s),
  card = p.get(p.tree.attrs.staringCard).attrs.guid;
assert.equal(links.getCaptureCandidate(card), null);
const window = p.get("window-fec0e0e5-9948-45c0-a43a-26d01d59cd0c");
s.setLocation(card, window.attrs.guid);
s.coords.set(card, [0, 0]);
const final = p.get("final-83bb9e64-d64a-450f-bf1d-04015cfdf6db");
s.setState(s.stateOwners.get(final.attrs.guid), final);
const candidate = links.getCaptureCandidate(card, "OVER");
assert.ok(candidate);
assert.equal(
  candidate.cardGUID,
  "card001-3e88f77f-2f24-4b3c-addc-c930a422186c",
);
assert.equal(
  candidate.locationGUID,
  "window_hole-a44e97cb-43bd-4133-9a5c-dfe5a653e1c3",
);
const release = links.release(card);
assert.equal(release.draggedGUID, candidate.cardGUID);
assert.deepEqual(s.coords.get(card), [0, 0]);
assert.ok(s.inPlay.has(candidate.cardGUID));
assert.equal(links.getCaptureCandidate(card, "OVER"), null);
assert.equal(links.place(candidate.cardGUID, [1, 0]), true);
assert.equal(links.direction(card, candidate.cardGUID), "EAST");
assert.equal(links.direction(candidate.cardGUID, card), "WEST");
assert.equal(links.place(candidate.cardGUID, [0, 0]), true);
assert.equal(s.captors.get(candidate.cardGUID), card);
assert.equal(links.captureSides.get(candidate.cardGUID), "OVER");
assert.equal(s.inPlay.has(candidate.cardGUID), false);
assert.equal(
  links.getCaptureCandidate(card, "OVER")?.cardGUID,
  candidate.cardGUID,
);
assert.equal(links.release(card).draggedGUID, candidate.cardGUID);
assert.equal(s.captors.has(candidate.cardGUID), false);
assert.equal(links.direction(card, candidate.cardGUID), "NONE");
const link = p.get(candidate.linkGUID),
  other = p.get(candidate.cardGUID),
  allowed = p.get(other.attrs.startingLocation);
const cloned = link,
  originalAllowed = link.attrs.otherCardLocations;
cloned.attrs.otherCardLocations = allowed.attrs.guid;
assert.equal(links.isEnabled(cloned), true);
s.targets.set(
  candidate.cardGUID,
  p.container(allowed, "transitions", "LocationTransition")[0]?.attrs.guid,
);
if (s.targets.get(candidate.cardGUID))
  assert.equal(links.isEnabled(cloned), false);
link.attrs.otherCardLocations = originalAllowed;
console.log(
  "CardLink检查通过：开场无捕获、真实window OVER来源、分离保留原卡、邻格方向、真实允许叠合、释放后关系清理。",
);

// 小夹具覆盖原版默认ALL、CardStatus失败后的negated，以及持久捕获方向。
const leaf = (value) => ({
  type: "AtomicPredicate",
  attrs: { subject: value },
  children: [],
});
const fixture = {
  type: "CompoundPredicate",
  attrs: {},
  children: [
    { type: "predicates", attrs: {}, children: [leaf("yes"), leaf("no")] },
  ],
};
const oldSatisfied = s.isSatisfied;
s.isSatisfied = (n) => n.attrs.subject === "yes";
assert.equal(links.predicate(fixture), false);
s.isSatisfied = oldSatisfied;
const negated = {
  type: "AtomicPredicate",
  attrs: { subject: link.attrs.guid, cardStatus: "IN_PLAY", negated: "true" },
  children: [],
};
s.inPlay.delete(card);
assert.equal(links.predicate(negated), true);
negated.attrs.negated = "false";
assert.equal(links.predicate(negated), false);
s.inPlay.add(card);
assert.equal(new LinkModel(p, s).captureSides, links.captureSides);
assert.throws(() => links.release("not-a-card"), /GUID/);
assert.throws(() => links.place("not-a-card", [0, 0]), /GUID/);
assert.throws(() => links.capture(card, card, "OVER"), /自身/);
const child = candidate.cardGUID;
s.captors.set(card, child);
assert.throws(() => links.capture(card, child, "OVER"), /循环/);
s.captors.delete(card);
console.log(
  "边界回归通过：缺省ALL、状态否定、共享captureSides、无效GUID、自捕获与循环。",
);
