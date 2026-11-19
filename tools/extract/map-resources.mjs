import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const assets = JSON.parse(
  fs.readFileSync(path.join(root, "work/asset-inventory.json")),
);
const bundle = JSON.parse(
  fs.readFileSync(path.join(root, "work/bundle-inventory.json")),
);
const fd = fs.openSync(path.join(root, "work/bundle-data.bin"), "r");
const read = (offset, size) => {
  const b = Buffer.alloc(size);
  if (fs.readSync(fd, b, 0, size, offset) !== size)
    throw new Error("读取不完整");
  return b;
};
const gameManagers = assets.find((a) => a.name === "globalgamemanagers");
const resourceManager = gameManagers.objects.find((o) => o.classId === 147);
const base = bundle.members.find((m) => m.name === "globalgamemanagers").offset;
const b = read(base + resourceManager.offset, resourceManager.size);
let p = 0;
const i32 = () => {
  const n = b.readInt32LE(p);
  p += 4;
  return n;
};
const text = () => {
  const n = i32();
  if (n < 0 || p + n > b.length) throw new Error("字符串越界");
  const value = b.toString("utf8", p, p + n);
  p = Math.ceil((p + n) / 4) * 4;
  return value;
};
const count = i32(),
  resources = [];
for (let i = 0; i < count; i++) {
  const name = text(),
    fileId = i32(),
    pathId = b.readBigInt64LE(p).toString();
  p += 8;
  resources.push({ name, fileId, pathId });
}
fs.closeSync(fd);
fs.writeFileSync(
  path.join(root, "work/resource-map.json"),
  JSON.stringify(
    { count, bytesConsumed: p, objectBytes: b.length, resources },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    count,
    bytesConsumed: p,
    objectBytes: b.length,
    samples: resources
      .filter((x) => /card002\.0$|card002$|Gorogoa|chapter1/.test(x.name))
      .slice(0, 14),
  }),
);
