import assert from "node:assert/strict";
import { AtlasStore } from "../../src/engine/render/atlas.js";
let decoded = 0;
globalThis.Image = class {
  async decode() {
    decoded++;
  }
};
const MiB = 1024 * 1024;
const store = new AtlasStore(
  {
    textures: ["a", "b", "c", "d"].map((url) => ({
      key: url,
      url,
      width: 512,
      height: 512,
    })),
  },
  { entries: [] },
  { baseUrl: "http://localhost/", cacheBudget: 2 * MiB },
);
const region = (url) => ({ textureUrl: url });
store.retainActive(["a", "b", "c"]);
await Promise.all(["a", "b", "c"].map((url) => store.image(region(url))));
assert.equal(store.images.size, 3);
assert.equal(store.cachedBytes, 3 * MiB);
store.retainActive(["c"]);
assert.equal(store.images.size, 2);
assert.equal(store.cachedBytes, 2 * MiB);
assert.ok(store.images.has("c"));
await store.image(region("b"));
store.retainActive([]);
await store.image(region("d"));
assert.equal(store.images.size, 2);
assert.ok(store.images.has("b"));
assert.ok(store.images.has("d"));
assert.equal(store.cachedBytes, 2 * MiB);
assert.equal(decoded, 4);
await store.image(region("b"));
assert.equal(decoded, 4);
console.log(
  "图集缓存检查通过：按解码字节预算逐出非活动 LRU，活动集合可超软限，缓存命中不重复 decode。",
);
