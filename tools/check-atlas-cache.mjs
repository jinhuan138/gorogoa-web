import assert from "node:assert/strict";
import { AtlasStore } from "../src/engine/atlas.js";
let decoded = 0;
globalThis.Image = class {
  async decode() {
    decoded++;
  }
};
const store = new AtlasStore(
  { textures: [] },
  { entries: [] },
  { baseUrl: "http://localhost/", maxCachedTextures: 2 },
);
const region = (url) => ({ textureUrl: url });
store.retainActive(["a", "b", "c"]);
await Promise.all(["a", "b", "c"].map((url) => store.image(region(url))));
assert.equal(store.images.size, 3);
store.retainActive(["c"]);
assert.equal(store.images.size, 2);
assert.ok(store.images.has("c"));
await store.image(region("b"));
store.retainActive([]);
await store.image(region("d"));
assert.equal(store.images.size, 2);
assert.ok(store.images.has("b"));
assert.ok(store.images.has("d"));
assert.equal(decoded, 4);
await store.image(region("b"));
assert.equal(decoded, 4);
console.log(
  "图集缓存检查通过：活动集合可超软限，非活动LRU逐出，缓存命中不重复decode。",
);
