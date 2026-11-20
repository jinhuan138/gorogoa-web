export function normalizeSource(filename) {
  let value = String(filename || "").replaceAll("\\", "/");
  const index = value.toLocaleLowerCase().lastIndexOf("/assets/");
  if (index >= 0) value = value.slice(index + 8);
  return value
    .replace(/\.png$/i, "")
    .replace(/^\/+/, "")
    .toLocaleLowerCase();
}
export class AtlasStore {
  constructor(
    manifest,
    atlases,
    {
      baseUrl = globalThis.document?.baseURI,
      maxCachedTextures = 16,
      maxPrefetchTextures = 2,
      prefetchBudget = 32 * 1024 * 1024,
    } = {},
  ) {
    this.baseUrl = baseUrl;
    this.textures = new Map(manifest.textures.map((t) => [t.key, t]));
    this.texturesByUrl = new Map(manifest.textures.map((t) => [t.url, t]));
    this.regions = new Map();
    this.images = new Map();
    this.active = new Set();
    this.lastUsed = new Map();
    this.cacheTick = 0;
    this.maxCachedTextures = maxCachedTextures;
    this.maxPrefetchTextures = maxPrefetchTextures;
    this.prefetchBudget = prefetchBudget;
    this.prefetched = new Map();
    this.pending = new Set();
    for (const region of atlases.entries) {
      const key = normalizeSource(region.source);
      const entries = this.regions.get(key) || [];
      entries.push(region);
      this.regions.set(key, entries);
    }
  }
  find(filename) {
    const found = this.regions.get(normalizeSource(filename)) || [];
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new Error(`素材引用多义: ${filename}`);
    return undefined;
  }
  retainActive(urls) {
    this.active = new Set(urls);
    for (const url of this.active) this.prefetched.delete(url);
    this.prune();
  }
  prune() {
    const removable = [...this.images.keys()]
      .filter((url) => !this.active.has(url) && !this.pending.has(url))
      .sort(
        (a, b) => (this.lastUsed.get(a) || 0) - (this.lastUsed.get(b) || 0),
      );
    for (const url of removable) {
      if (this.images.size <= this.maxCachedTextures) break;
      this.images.delete(url);
      this.lastUsed.delete(url);
      this.prefetched.delete(url);
    }
  }
  prefetch(urls) {
    const wanted = new Set(urls);
    for (const url of this.prefetched.keys()) {
      if (wanted.has(url) || this.pending.has(url)) continue;
      this.prefetched.delete(url);
      this.images.delete(url);
      this.lastUsed.delete(url);
    }
    let bytes = [...this.prefetched.values()].reduce(
      (sum, size) => sum + size,
      0,
    );
    const requests = [];
    for (const url of wanted) {
      if (this.images.has(url) || this.active.has(url)) continue;
      if (this.prefetched.size >= this.maxPrefetchTextures) break;
      const texture = this.texturesByUrl.get(url);
      if (!texture) continue;
      const size = texture.width * texture.height * 4;
      if (bytes + size > this.prefetchBudget) continue;
      if (this.images.size >= this.maxCachedTextures) {
        const oldest = [...this.images.keys()]
          .filter(
            (cached) =>
              !this.active.has(cached) &&
              !this.pending.has(cached) &&
              !this.prefetched.has(cached),
          )
          .sort((a, b) => this.lastUsed.get(a) - this.lastUsed.get(b))[0];
        if (!oldest || this.images.size > this.maxCachedTextures) break;
        this.images.delete(oldest);
        this.lastUsed.delete(oldest);
      }
      bytes += size;
      this.prefetched.set(url, size);
      requests.push(this.image({ textureUrl: url }));
    }
    // 预取失败不影响导航；正式绘制仍可按需重试。
    return Promise.allSettled(requests);
  }
  image(region) {
    if (!this.baseUrl) return Promise.reject(new Error("缺少图片根URL"));
    let pending = this.images.get(region.textureUrl);
    if (!pending) {
      pending = (async () => {
        const image = new Image();
        image.src = new URL(region.textureUrl, this.baseUrl).href;
        await image.decode();
        return image;
      })();
      this.images.set(region.textureUrl, pending);
      this.pending.add(region.textureUrl);
      pending.then(
        () => {
          this.pending.delete(region.textureUrl);
          this.prune();
        },
        () => {
          this.pending.delete(region.textureUrl);
          if (this.images.get(region.textureUrl) === pending) {
            this.images.delete(region.textureUrl);
            this.lastUsed.delete(region.textureUrl);
            this.prefetched.delete(region.textureUrl);
          }
        },
      );
    }
    this.lastUsed.set(region.textureUrl, ++this.cacheTick);
    this.prune();
    return pending;
  }
  crop(region) {
    const texture = this.textures.get(region.textureKey);
    if (!texture) throw new Error(`缺少图集: ${region.textureKey}`);
    return [region.u, texture.height - region.v - region.h, region.w, region.h];
  }
}
