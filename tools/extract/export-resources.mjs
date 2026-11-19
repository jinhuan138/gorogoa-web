import { decodeDxt } from "./texture-codecs.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const inventory = JSON.parse(
  fs.readFileSync(path.join(root, "work/asset-inventory.json")),
);
const bundle = JSON.parse(
  fs.readFileSync(path.join(root, "work/bundle-inventory.json")),
);
const fd = fs.openSync(path.join(root, "work/bundle-data.bin"), "r");
const textRoot = path.join(root, "work/extracted-text");
fs.mkdirSync(textRoot, { recursive: true });
const textureRoot = path.join(root, "public/assets/textures");
fs.mkdirSync(textureRoot, { recursive: true });
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const tag = Buffer.from(type),
    payload = Buffer.concat([tag, data]);
  let crc = 0xffffffff;
  for (const n of payload) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4,
    scan = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    rgba.copy(
      scan,
      y * (stride + 1) + 1,
      (height - 1 - y) * stride,
      (height - y) * stride,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scan, { level: 3 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const textures = [],
  texts = [],
  failures = [];
try {
  for (const asset of inventory) {
    const member = bundle.members.find((x) => x.name === asset.name);
    const group = path.basename(asset.name).replace(/[^a-zA-Z0-9_-]/g, "-");
    for (const item of asset.objects || []) {
      if (![28, 49].includes(item.classId)) continue;
      try {
        const b = Buffer.alloc(item.size);
        if (
          fs.readSync(fd, b, 0, b.length, member.offset + item.offset) !==
          b.length
        )
          throw new Error("对象读取不完整");
        let p = 0;
        const u32 = () => {
          const v = b.readUInt32LE(p);
          p += 4;
          return v;
        };
        const alignedString = () => {
          const length = u32();
          if (length > b.length - p) throw new Error("名称越界");
          const name = b.toString("utf8", p, p + length);
          p += length;
          p = Math.ceil(p / 4) * 4;
          return name;
        };
        const name = alignedString(),
          key = `${group}/${item.pathId}`,
          stem = `${group}-${item.pathId}-${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
        if (item.classId === 49) {
          const size = u32();
          if (p + size > b.length) throw new Error("文本越界");
          const bytes = b.subarray(p, p + size);
          const filename = `${stem}.txt`;
          fs.writeFileSync(path.join(textRoot, filename), bytes);
          texts.push({
            key,
            name,
            bytes: size,
            sha256: hash(bytes),
            file: `work/extracted-text/${filename}`,
            preview: bytes.toString("utf8", 0, Math.min(120, size)),
          });
          continue;
        }
        p += 8;
        const width = u32(),
          height = u32(),
          imageSize = u32(),
          format = u32(),
          mipCount = u32();
        p++;
        p = Math.ceil(p / 4) * 4;
        const imageCount = u32(),
          dimension = u32();
        p += 24;
        const lightmapFormat = u32(),
          colorSpace = u32(),
          size = u32();
        if ((!width || !height) && name === "Font Texture") {
          textures.push({
            key,
            name,
            width,
            height,
            format,
            status: "runtime-font",
          });
          continue;
        }
        if (!width || !height || width * height > 64 * 1024 ** 2)
          throw new Error("纹理尺寸无效");
        const record = {
          key,
          name,
          width,
          height,
          format,
          mipCount,
          imageSize,
          imageCount,
          dimension,
          lightmapFormat,
          colorSpace,
          size,
          status: "unconverted",
        };
        if (size === 0) {
          record.status = "external-stream";
          record.streamOffset = u32();
          record.streamSize = u32();
          record.streamPath = alignedString();
          textures.push(record);
          continue;
        }
        if (p + size > b.length) throw new Error("纹理数据越界");
        if (![1, 3, 4, 5, 10, 12, 14].includes(format)) {
          record.status = "unsupported-format";
          textures.push(record);
          continue;
        }
        const pixels = width * height,
          channels = format === 1 ? 1 : format === 3 ? 3 : 4;
        if (![10, 12].includes(format) && size < pixels * channels)
          throw new Error("首层像素数据不足");
        const raw = b.subarray(p, p + pixels * channels),
          rgba = Buffer.alloc(pixels * 4);
        for (let i = 0; i < pixels && ![10, 12].includes(format); i++) {
          const src = i * channels,
            dst = i * 4;
          if (format === 1) {
            rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = 255;
            rgba[dst + 3] = raw[src];
          } else if (format === 5) {
            rgba[dst] = raw[src + 1];
            rgba[dst + 1] = raw[src + 2];
            rgba[dst + 2] = raw[src + 3];
            rgba[dst + 3] = raw[src];
          } else if (format === 14) {
            rgba[dst] = raw[src + 2];
            rgba[dst + 1] = raw[src + 1];
            rgba[dst + 2] = raw[src];
            rgba[dst + 3] = raw[src + 3];
          } else {
            raw.copy(rgba, dst, src, src + Math.min(channels, 4));
            if (channels === 3) rgba[dst + 3] = 255;
          }
        }
        const result = png(
            width,
            height,
            [10, 12].includes(format)
              ? decodeDxt(b.subarray(p, p + size), width, height, format)
              : rgba,
          ),
          filename = `${stem}.png`;
        fs.writeFileSync(path.join(textureRoot, filename), result);
        record.status = "converted";
        record.url = `assets/textures/${filename}`;
        record.sha256 = hash(result);
        textures.push(record);
      } catch (error) {
        failures.push({
          asset: asset.name,
          pathId: item.pathId,
          name: item.name,
          error: error.message,
        });
      }
    }
  }
} finally {
  fs.closeSync(fd);
}
const manifest = {
  sourceBundleSha256: bundle.sha256,
  scope:
    "从原版字节解析；PNG 为无损首层纹理，纵向翻转以适配网页；尚未与原游戏截图校验",
  textures,
  texts,
  failures,
};
fs.writeFileSync(
  path.join(root, "work/export-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
fs.writeFileSync(
  path.join(root, "public/assets/manifest.json"),
  JSON.stringify(
    { textures, sourceBundleSha256: bundle.sha256, failures },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    textures: textures.length,
    converted: textures.filter((t) => t.status === "converted").length,
    formats: [...new Set(textures.map((t) => t.format))],
    texts: texts.length,
    failureCount: failures.length,
    failureSample: failures.slice(0, 3),
    projects: texts.filter((t) => /Gorogoa\.project/.test(t.name)),
  }),
);
