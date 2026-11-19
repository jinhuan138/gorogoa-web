import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { vi } from "vitest";

export function createBrowser(root) {
  let time = 0;
  let frame;
  const contexts = new WeakMap();
  const store = new Map();
  const pixelCalls = { images: 0 };
  const errors = [];
  const siteUrl = document.baseURI;
  const sitePath = new URL(siteUrl).pathname;
  function drawing() {
    const context = {
      globalAlpha: 1,
      drawImage() {
        pixelCalls.images++;
      },
    };
    const stack = [];
    context.save = () => stack.push(context.globalAlpha);
    context.restore = () => {
      assert.ok(stack.length);
      context.globalAlpha = stack.pop();
    };
    return new Proxy(context, {
      get: (target, key) => (key in target ? target[key] : () => {}),
    });
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (type) {
      if (type !== "2d") return null;
      if (!contexts.has(this)) contexts.set(this, drawing());
      return contexts.get(this);
    },
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => ({ left: 0, top: 0, width: 716, height: 716 }));
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
    async function () {
      assert.ok(this.src.startsWith(siteUrl + "assets/textures/"));
    },
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.context = drawing();
      }
      getContext() {
        return this.context;
      }
    },
  );
  vi.stubGlobal("localStorage", {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  });
  vi.spyOn(performance, "now").mockImplementation(() => time * 1000);
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    assert.equal(frame, undefined, "游戏只能有一个待执行帧");
    frame = callback;
    return 1;
  });
  vi.stubGlobal("fetch", async (url) => {
    const pathname = new URL(url).pathname;
    assert.ok(pathname.startsWith(sitePath + "assets/"));
    const path = pathname.slice(sitePath.length);
    return new Response(
      await readFile(fileURLToPath(new URL("public/" + path, root))),
    );
  });
  vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
  return {
    store,
    pixelCalls,
    errors,
    siteUrl,
    get time() {
      return time;
    },
    set time(value) {
      time = value;
    },
    async step(count = 1, delta = 0.25) {
      for (let i = 0; i < count; i++) {
        time += delta;
        assert.ok(frame, "游戏没有安排下一帧");
        const next = frame;
        frame = undefined;
        await next();
        await setImmediate();
        assert.deepEqual(errors, []);
      }
    },
  };
}
