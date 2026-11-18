import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const manifest = read('assets/manifest.json');
const atlas = read('assets/data/atlases.json');
const summary = read('assets/data/project-summary.json');
assert.equal(manifest.failures.length, 0);
assert.equal(atlas.missingAtlases.length, 0);

function pngSize(data, url) {
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', url);
  assert.equal(data.toString('ascii', 12, 16), 'IHDR', url);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function webpSize(data, url) {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF', url);
  assert.equal(data.readUInt32LE(4) + 8, data.length, url);
  assert.equal(data.toString('ascii', 8, 16), 'WEBPVP8L', url);
  assert.equal(data[20], 0x2f, url);
  const info = data.readUInt32LE(21);
  assert.equal(info >>> 29, 0, url);
  return [(info & 0x3fff) + 1, ((info >>> 14) & 0x3fff) + 1];
}

const byKey = new Map(manifest.textures.map(texture => [texture.key, texture]));
const formats = { '.png': pngSize, '.webp': webpSize };
const counts = { '.png': 0, '.webp': 0 };
for (const texture of manifest.textures.filter(texture => texture.status === 'converted')) {
  const format = path.extname(texture.url);
  assert.ok(formats[format], texture.url);
  const data = fs.readFileSync(path.join(root, texture.url));
  assert.deepEqual(formats[format](data, texture.url), [texture.width, texture.height], texture.url);
  assert.equal(createHash('sha256').update(data).digest('hex'), texture.sha256, texture.url);
  counts[format]++;
}

for (const region of atlas.entries) {
  const texture = byKey.get(region.textureKey);
  assert.equal(texture?.status, 'converted', region.source);
  assert.equal(region.textureUrl, texture.url, region.source);
  assert.ok(region.u >= 0 && region.v >= 0 && region.w > 0 && region.h > 0, region.source);
  assert.ok(region.u + region.w <= texture.width && region.v + region.h <= texture.height, region.source);
  assert.ok(region.offsetX >= 0 && region.offsetY >= 0, region.source);
  assert.ok(region.offsetX + region.w <= region.originalW + 3 && region.offsetY + region.h <= region.originalH + 3, region.source);
}

// A startup PNG is retained at its original URL. Check its image data as well as its header.
const sample = byKey.get('resources-assets/496');
const png = fs.readFileSync(path.join(root, sample.url));
const chunks = [];
for (let offset = 8; offset < png.length;) {
  const size = png.readUInt32BE(offset);
  if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
  offset += size + 12;
}
const pixels = zlib.inflateSync(Buffer.concat(chunks));
const stride = sample.width * 4 + 1;
assert.equal(pixels.length, stride * sample.height);
for (let y = 0; y < sample.height; y++) assert.ok(pixels[y * stride] <= 4);
assert.equal(summary.counts.Card, 25);
console.log(`素材检查通过：${counts['.png']} 张 PNG、${counts['.webp']} 张无损 WebP、${atlas.entries.length} 个图集区域、${summary.counts.Card} 张卡片。`);

