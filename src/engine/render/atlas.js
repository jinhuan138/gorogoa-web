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
      cacheBudget = 128 * 1024 * 1024,
      maxPrefetchTextures = 2,
      prefetchBudget = 32 * 1024 * 1024,
    } = {},
  ) {
    this.baseUrl = baseUrl;
    this.textures = new Map(manifest.textures.map((t) => [t.key, t]));
    this.texturesByUrl = new Map(manifest.textures.map((t) => [t.url, t]));
    this.regions = new Map();
    this.images = new Map();
    this.decoded = new Map();
    this.active = new Set();
    this.lastUsed = new Map();
    this.cacheTick = 0;
    this.cacheBudget = cacheBudget;
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
  textureBytes(url) {
    const { width, height } = this.texturesByUrl.get(url);
    return width * height * 4;
  }
  // 按 RGBA 像素估算，也为正在解码的图集计入预算。
  get cachedBytes() {
    let bytes = 0;
    for (const url of this.images.keys()) bytes += this.textureBytes(url);
    return bytes;
  }
  remove(url) {
    this.images.delete(url);
    this.decoded.delete(url);
    this.lastUsed.delete(url);
    this.prefetched.delete(url);
  }
  retainActive(urls) {
    this.active = new Set(urls);
    for (const url of this.active) this.prefetched.delete(url);
    this.prune();
  }
  prune(reserve = 0) {
    let bytes = this.cachedBytes + reserve;
    if (bytes <= this.cacheBudget) return true;
    const removable = [...this.images.keys()]
      .filter(
        (url) =>
          !this.active.has(url) &&
          !this.pending.has(url) &&
          (!reserve || !this.prefetched.has(url)),
      )
      .sort((a, b) => this.lastUsed.get(a) - this.lastUsed.get(b));
    // 预取先确认能腾出足够空间，不为放不下的图集清空现有缓存。
    if (
      reserve &&
      bytes - removable.reduce((sum, url) => sum + this.textureBytes(url), 0) >
      this.cacheBudget
    )
      return false;
    for (const url of removable) {
      if (bytes <= this.cacheBudget) break;
      bytes -= this.textureBytes(url);
      this.remove(url);
    }
    // 正在显示和解码的图集允许暂时超过软预算。
    return bytes <= this.cacheBudget;
  }
  prefetch(urls) {
    const wanted = new Set(urls);
    for (const url of this.prefetched.keys()) {
      if (wanted.has(url) || this.pending.has(url)) continue;
      this.remove(url);
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
      const size = this.textureBytes(url);
      if (bytes + size > this.prefetchBudget || !this.prune(size)) continue;
      bytes += size;
      this.prefetched.set(url, size);
      requests.push(this.image({ textureUrl: url }));
    }
    // 预取失败不影响导航；正式绘制仍可按需重试。
    return Promise.allSettled(requests);
  }
  async prepare(urls, onTextureLoaded) {
    const images = new Map();
    const failures = new Map();
    await Promise.all(
      urls.map(async (url) => {
        try {
          images.set(url, await this.image({ textureUrl: url }));
        } catch (error) {
          failures.set(url, error.message);
        }
        onTextureLoaded?.(url, !failures.has(url));
      }),
    );
    return { images, failures };
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
        (image) => {
          if (this.images.get(region.textureUrl) === pending)
            this.decoded.set(region.textureUrl, image);
          this.pending.delete(region.textureUrl);
          this.prune();
        },
        () => {
          this.pending.delete(region.textureUrl);
          if (this.images.get(region.textureUrl) === pending)
            this.remove(region.textureUrl);
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
