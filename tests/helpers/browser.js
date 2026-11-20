import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { vi } from "vitest";

export function createBrowser(root) {
  let time = 0;
  let frame;
  let hidden = false;
  let rect = { left: 0, top: 0, width: 716, height: 716 };
  const observers = new Set();
  const surfaces = [];
  let recordDrawing = false;
  const contexts = new WeakMap();
  const store = new Map();
  const pixelCalls = { images: 0 };
  const errors = [];
  const siteUrl = document.baseURI;
  const sitePath = new URL(siteUrl).pathname;
  function drawing(canvas) {
    const context = {
      canvas,
      globalAlpha: 1,
      scale() {},
      setTransform() {},
      drawImage() {
        pixelCalls.images++;
      },
    };
    if (recordDrawing)
      for (const key of ["scale", "setTransform", "drawImage"])
        vi.spyOn(context, key);
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
      if (!contexts.has(this)) contexts.set(this, drawing(this));
      return contexts.get(this);
    },
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => rect);
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
        this.context = drawing(this);
        if (recordDrawing) surfaces.push(this);
      }
      getContext() {
        return this.context;
      }
    },
  );
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        this.callback = callback;
        observers.add(this);
      }
      observe() {}
      disconnect() {
        observers.delete(this);
      }
    },
  );
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
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
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
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
    surfaces,
    captureDrawing() {
      recordDrawing = true;
    },
    get pendingFrame() {
      return Boolean(frame);
    },
    get observerCount() {
      return observers.size;
    },
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    resize(width, height, dpr = globalThis.devicePixelRatio) {
      rect = { ...rect, width, height };
      vi.stubGlobal("devicePixelRatio", dpr);
      for (const observer of observers) observer.callback();
    },
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
