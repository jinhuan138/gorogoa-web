import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const game = process.argv[2];
if (!game || !path.isAbsolute(game)) throw new Error("需要原版游戏的绝对路径");
const out = path.join(root, "work");
fs.mkdirSync(out, { recursive: true });
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
class Reader {
  constructor(data, little = false) {
    this.data = data;
    this.pos = 0;
    this.little = little;
  }
  bytes(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.data.length)
      throw new Error(`读取越界: ${this.pos}+${n}/${this.data.length}`);
    const b = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u8() {
    return this.bytes(1)[0];
  }
  u16() {
    const b = this.bytes(2);
    return this.little ? b.readUInt16LE() : b.readUInt16BE();
  }
  i16() {
    const b = this.bytes(2);
    return this.little ? b.readInt16LE() : b.readInt16BE();
  }
  u32() {
    const b = this.bytes(4);
    return this.little ? b.readUInt32LE() : b.readUInt32BE();
  }
  i32() {
    const b = this.bytes(4);
    return this.little ? b.readInt32LE() : b.readInt32BE();
  }
  u64() {
    const b = this.bytes(8);
    const v = this.little ? b.readBigUInt64LE() : b.readBigUInt64BE();
    if (v > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("整数超出安全范围");
    return Number(v);
  }
  cstr() {
    const end = this.data.indexOf(0, this.pos);
    if (end < 0) throw new Error("字符串未结束");
    return this.bytes(end - this.pos + 1)
      .subarray(0, -1)
      .toString("utf8");
  }
  align(n = 4) {
    this.bytes((n - (this.pos % n)) % n);
  }
  text() {
    const s = this.bytes(this.i32()).toString("utf8");
    this.align();
    return s;
  }
}
function lz4(input, size) {
  const output = Buffer.alloc(size);
  let ip = 0,
    op = 0;
  const extended = (initial) => {
    let n = initial;
    if (n === 15) {
      let v;
      do {
        if (ip >= input.length) throw new Error("LZ4 长度缺失");
        v = input[ip++];
        n += v;
      } while (v === 255);
    }
    return n;
  };
  while (ip < input.length) {
    const token = input[ip++];
    const count = extended(token >>> 4);
    if (ip + count > input.length || op + count > size)
      throw new Error("LZ4 字面量越界");
    input.copy(output, op, ip, ip + count);
    ip += count;
    op += count;
    if (ip === input.length) break;
    if (ip + 2 > input.length) throw new Error("LZ4 引用缺失");
    const distance = input.readUInt16LE(ip);
    ip += 2;
    const length = extended(token & 15) + 4;
    if (!distance || distance > op || op + length > size)
      throw new Error("LZ4 引用越界");
    for (let j = 0; j < length; j++) {
      output[op] = output[op - distance];
      op++;
    }
  }
  if (op !== size) throw new Error(`LZ4 大小不符: ${op}/${size}`);
  return output;
}
function decode(data, size, flags) {
  const codec = flags & 63;
  if (codec === 0) {
    if (data.length !== size) throw new Error("未压缩块长度不符");
    return data;
  }
  if (codec === 2 || codec === 3) return lz4(data, size);
  throw new Error(`暂不支持压缩类型 ${codec}；未安装额外依赖`);
}
function bundleInventory(filename) {
  const data = fs.readFileSync(filename);
  const r = new Reader(data);
  const signature = r.cstr();
  if (signature !== "UnityFS") throw new Error(`不支持包格式 ${signature}`);
  const format = r.u32(),
    player = r.cstr(),
    engine = r.cstr(),
    declaredSize = r.u64();
  const packedInfo = r.u32(),
    rawInfo = r.u32(),
    flags = r.u32();
  if (format !== 6 || !engine.startsWith("2017."))
    throw new Error(
      `只支持已确认的 Unity 2017 / 包版本 6: ${engine}/${format}`,
    );
  if (declaredSize !== data.length) throw new Error("资源包大小与头部不符");
  const infoStart = flags & 128 ? data.length - packedInfo : r.pos;
  const info = new Reader(
    decode(data.subarray(infoStart, infoStart + packedInfo), rawInfo, flags),
  );
  info.bytes(16);
  const blockCount = info.u32(),
    blocks = [];
  for (let i = 0; i < blockCount; i++)
    blocks.push({
      rawSize: info.u32(),
      packedSize: info.u32(),
      flags: info.u16(),
    });
  const memberCount = info.u32(),
    members = [];
  for (let i = 0; i < memberCount; i++)
    members.push({
      offset: info.u64(),
      size: info.u64(),
      flags: info.u32(),
      name: info.cstr(),
    });
  const total = blocks.reduce((n, b) => n + b.rawSize, 0);
  if (total > 2 * 1024 ** 3)
    throw new Error(`包展开 ${total} 字节，超过本次 2GiB 上限`);
  const summary = {
    source: filename,
    sha256: digest(data),
    signature,
    format,
    player,
    engine,
    flags,
    packedSize: data.length,
    rawSize: total,
    blockCount,
    blocks,
    members,
  };
  fs.writeFileSync(
    path.join(out, "bundle-inventory.json"),
    JSON.stringify(summary, null, 2),
  );
  const fd = fs.openSync(path.join(out, "bundle-data.bin"), "w");
  let cursor = flags & 128 ? r.pos : r.pos + packedInfo;
  try {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const chunk = decode(
        data.subarray(cursor, cursor + b.packedSize),
        b.rawSize,
        b.flags,
      );
      fs.writeSync(fd, chunk);
      cursor += b.packedSize;
    }
  } finally {
    fs.closeSync(fd);
  }
  return summary;
}
function serializedInventory(
  data,
  name,
  fullSize = data.length,
  readObject = null,
) {
  const r = new Reader(data);
  const metadataSize = r.u32(),
    fileSize = r.u32(),
    version = r.u32(),
    dataOffset = r.u32();
  if (version !== 17) return { name, supported: false, version };
  const endian = r.u8();
  r.bytes(3);
  r.little = endian === 0;
  const unityVersion = r.cstr(),
    platform = r.i32(),
    hasTypeTrees = Boolean(r.u8()),
    typeCount = r.i32(),
    types = [];
  for (let i = 0; i < typeCount; i++) {
    const classId = r.i32(),
      stripped = r.u8(),
      scriptIndex = r.i16();
    const scriptId = classId === 114 ? r.bytes(16).toString("hex") : null;
    const typeHash = r.bytes(16).toString("hex");
    if (hasTypeTrees) {
      const nodes = r.i32(),
        stringBytes = r.i32();
      r.bytes(nodes * 24 + stringBytes);
    }
    types.push({ classId, stripped, scriptIndex, scriptId, typeHash });
  }
  const objectCount = r.i32(),
    objects = [],
    counts = {};
  for (let i = 0; i < objectCount; i++) {
    r.align();
    const pathId = r.u64(),
      offset = r.u32() + dataOffset,
      size = r.u32(),
      typeIndex = r.i32();
    if (!types[typeIndex] || offset + size > fullSize)
      throw new Error(`对象越界 ${name}/${pathId}`);
    const classId = types[typeIndex].classId;
    counts[classId] = (counts[classId] || 0) + 1;
    let objectName = null;
    if ([21, 28, 48, 49, 83, 115, 128, 213, 687078895].includes(classId)) {
      try {
        const b = new Reader(
          readObject
            ? readObject(offset, Math.min(size, 1024))
            : data.subarray(offset, offset + size),
          r.little,
        );
        objectName = b.text();
        if (objectName.length > 500 || /[\x00-\x08]/.test(objectName))
          objectName = null;
      } catch {
        objectName = null;
      }
    }
    objects.push({
      pathId,
      offset,
      size,
      typeIndex,
      classId,
      name: objectName,
    });
  }
  return {
    name,
    supported: true,
    metadataSize,
    fileSize,
    version,
    dataOffset,
    unityVersion,
    platform,
    hasTypeTrees,
    types,
    objectCount,
    counts,
    objects,
  };
}
function managedInventory(filename) {
  const b = fs.readFileSync(filename),
    pe = b.readUInt32LE(0x3c),
    optional = pe + 24;
  const sections = b.readUInt16LE(pe + 6),
    optSize = b.readUInt16LE(pe + 20),
    maps = [];
  for (let i = 0; i < sections; i++) {
    const p = optional + optSize + i * 40;
    maps.push({
      va: b.readUInt32LE(p + 12),
      size: Math.max(b.readUInt32LE(p + 8), b.readUInt32LE(p + 16)),
      raw: b.readUInt32LE(p + 20),
    });
  }
  const offset = (va) => {
    const s = maps.find((s) => va >= s.va && va < s.va + s.size);
    if (!s) throw new Error(`无映射 RVA ${va}`);
    return s.raw + va - s.va;
  };
  const dirs = optional + (b.readUInt16LE(optional) === 0x10b ? 96 : 112),
    cli = offset(b.readUInt32LE(dirs + 14 * 8));
  const meta = offset(b.readUInt32LE(cli + 8));
  const r = new Reader(b, true);
  r.pos = meta;
  if (r.u32() !== 0x424a5342) throw new Error("CLR 元数据签名不符");
  r.bytes(8);
  r.bytes(r.u32());
  r.align();
  r.u16();
  const count = r.u16(),
    streams = {};
  for (let i = 0; i < count; i++) {
    const p = r.u32(),
      size = r.u32(),
      name = r.cstr();
    r.align();
    streams[name] = { offset: meta + p, size };
  }
  const t = new Reader(b, true);
  t.pos = (streams["#~"] || streams["#-"]).offset;
  t.bytes(6);
  const heapFlags = t.u8();
  t.u8();
  const valid = b.readBigUInt64LE(t.pos);
  t.bytes(16);
  const rows = Array(64).fill(0);
  for (let i = 0; i < 64; i++) if (valid & (1n << BigInt(i))) rows[i] = t.u32();
  const strSize = heapFlags & 1 ? 4 : 2,
    guidSize = heapFlags & 2 ? 4 : 2,
    blobSize = heapFlags & 4 ? 4 : 2;
  const idxSize = (table) => (rows[table] >= 65536 ? 4 : 2);
  const codedSize = (tables, bits) =>
    Math.max(...tables.map((x) => rows[x])) >= 2 ** (16 - bits) ? 4 : 2;
  const sz = [
    2 + strSize + guidSize * 3,
    codedSize([0, 26, 35, 1], 2) + strSize * 2,
    4 + strSize * 2 + codedSize([2, 1, 27], 2) + idxSize(4) + idxSize(6),
    idxSize(4),
    2 + strSize + blobSize,
    idxSize(6),
    8 + strSize + blobSize + idxSize(8),
  ];
  const starts = [];
  let p = t.pos;
  for (let i = 0; i <= 6; i++) {
    starts[i] = p;
    p += rows[i] * sz[i];
  }
  const index = (size) => (size === 4 ? t.u32() : t.u16());
  const str = (index) => {
    const start = streams["#Strings"].offset + index,
      end = b.indexOf(0, start);
    return b.toString("utf8", start, end);
  };
  const types = [],
    methods = [],
    fields = [];
  for (let i = 0; i < rows[2]; i++) {
    t.pos = starts[2] + i * sz[2];
    const flags = t.u32(),
      name = str(index(strSize)),
      namespace = str(index(strSize));
    index(codedSize([2, 1, 27], 2));
    types.push({
      token: `0x${(0x02000001 + i).toString(16)}`,
      name,
      namespace,
      flags,
      firstField: index(idxSize(4)),
      firstMethod: index(idxSize(6)),
    });
  }
  for (let i = 0; i < rows[4]; i++) {
    t.pos = starts[4] + i * sz[4];
    const flags = t.u16(),
      name = str(index(strSize));
    fields.push({ token: `0x${(0x04000001 + i).toString(16)}`, flags, name });
  }
  for (let i = 0; i < rows[6]; i++) {
    t.pos = starts[6] + i * sz[6];
    const rva = t.u32(),
      implFlags = t.u16(),
      flags = t.u16(),
      name = str(index(strSize));
    methods.push({
      token: `0x${(0x06000001 + i).toString(16)}`,
      rva,
      implFlags,
      flags,
      name,
    });
  }
  types.forEach((type, i) => {
    type.fields = fields.slice(
      type.firstField - 1,
      (types[i + 1]?.firstField || fields.length + 1) - 1,
    );
    type.methods = methods.slice(
      type.firstMethod - 1,
      (types[i + 1]?.firstMethod || methods.length + 1) - 1,
    );
  });
  return {
    source: filename,
    sha256: digest(b),
    methodCount: methods.length,
    typeCount: types.length,
    fieldCount: fields.length,
    scope:
      "独立只读元数据目录；不执行程序集，不推断方法行为；不是 REA 已恢复的成员结果",
    types,
  };
}
const assembly = managedInventory(
  path.join(game, "Gorogoa_Data", "Managed", "Assembly-CSharp.dll"),
);
fs.writeFileSync(
  path.join(out, "managed-inventory.json"),
  JSON.stringify(assembly, null, 2),
);
console.log(
  JSON.stringify({
    types: assembly.typeCount,
    methods: assembly.methodCount,
    fields: assembly.fieldCount,
  }),
);
const bundle = bundleInventory(path.join(game, "Gorogoa_Data", "data.unity3d"));
console.log(
  JSON.stringify({
    packedSize: bundle.packedSize,
    rawSize: bundle.rawSize,
    members: bundle.members,
  }),
);
const fd = fs.openSync(path.join(out, "bundle-data.bin"), "r"),
  assets = [];
try {
  for (const member of bundle.members) {
    if (/\.(resS|resource)$/i.test(member.name)) continue;
    const header = Buffer.alloc(20);
    fs.readSync(fd, header, 0, 20, member.offset);
    const length = Math.min(member.size, header.readUInt32BE(0) + 20);
    const data = Buffer.alloc(length);
    const n = fs.readSync(fd, data, 0, data.length, member.offset);
    if (n !== data.length) throw new Error("成员读取不完整");
    const readObject = (offset, size) => {
      const bytes = Buffer.alloc(size);
      if (fs.readSync(fd, bytes, 0, size, member.offset + offset) !== size)
        throw new Error("对象读取不完整");
      return bytes;
    };
    const item = serializedInventory(
      data,
      member.name,
      member.size,
      readObject,
    );
    assets.push(item);
    console.log(
      JSON.stringify({
        name: item.name,
        version: item.version,
        objectCount: item.objectCount,
        hasTypeTrees: item.hasTypeTrees,
        counts: item.counts,
      }),
    );
  }
} finally {
  fs.closeSync(fd);
}
fs.writeFileSync(
  path.join(out, "asset-inventory.json"),
  JSON.stringify(assets, null, 2),
);
