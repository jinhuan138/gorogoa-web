import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { crc32 } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");

function pe32FileOffset(player) {
  const pe = player.readUInt32LE(0x3c);
  const optional = pe + 24;
  if (
    player.toString("ascii", pe, pe + 4) !== "PE\0\0" ||
    player.readUInt16LE(optional) !== 0x10b
  ) {
    throw new Error("原版 UnityPlayer.dll 的 PE32 格式不符");
  }
  const imageBase = player.readUInt32LE(optional + 28);
  const table = optional + player.readUInt16LE(pe + 20);
  const sections = Array.from(
    { length: player.readUInt16LE(pe + 6) },
    (_, index) => {
      const row = table + index * 40;
      return {
        rva: player.readUInt32LE(row + 12),
        size: player.readUInt32LE(row + 16),
        offset: player.readUInt32LE(row + 20),
      };
    },
  );
  return (address, size) => {
    const rva = address - imageBase;
    const section = sections.find(
      ({ rva: start, size: length }) =>
        size > 0 && rva >= start && rva + size <= start + length,
    );
    if (!section) return null;
    const offset = section.offset + rva - section.rva;
    return offset + size <= player.length ? offset : null;
  };
}

export function readUnityVorbisSetup(player, setupID) {
  const fileOffset = pe32FileOffset(player);
  const key = Buffer.alloc(4);
  key.writeUInt32LE(setupID);
  for (
    let row = player.indexOf(key);
    row !== -1;
    row = player.indexOf(key, row + 1)
  ) {
    // FMOD stores the CRC last. Some entries reuse a base packet with a patch.
    if (row < 20) continue;
    const size = player.readUInt32LE(row - 4);
    const variantAddress = player.readUInt32LE(row - 8);
    const variantOffset = player.readUInt32LE(row - 16);
    const variantSize = player.readUInt32LE(row - 12);
    const baseAddress = player.readUInt32LE(row - 20);
    const offset = fileOffset(baseAddress || variantAddress, size);
    if (
      offset === null ||
      !player.subarray(offset, offset + 7).equals(Buffer.from("\x05vorbis"))
    )
      continue;
    const bytes = Buffer.from(player.subarray(offset, offset + size));
    const source = { offset, size };
    if (baseAddress) {
      const patchFileOffset = fileOffset(variantAddress, variantSize);
      if (patchFileOffset === null || variantOffset + variantSize > size)
        continue;
      player.copy(
        bytes,
        variantOffset,
        patchFileOffset,
        patchFileOffset + variantSize,
      );
      source.patch = {
        fileOffset: patchFileOffset,
        packetOffset: variantOffset,
        size: variantSize,
      };
    }
    if (crc32(bytes) === setupID) return { bytes, source };
  }
  throw new Error(
    `UnityPlayer.dll 中找不到匹配 CRC32 的 Vorbis setup：${setupID.toString(16)}`,
  );
}
class Bits {
  constructor(data) {
    this.data = data;
    this.pos = 0;
  }
  read(count) {
    if (count < 0 || this.pos + count > this.data.length * 8)
      throw new Error("Vorbis位流越界");
    let value = 0;
    for (let i = 0; i < count; i++, this.pos++)
      value += ((this.data[this.pos >>> 3] >>> (this.pos & 7)) & 1) * 2 ** i;
    return value;
  }
  skip(count) {
    if (this.pos + count > this.data.length * 8)
      throw new Error("Vorbis跳过越界");
    this.pos += count;
  }
}
const ilog = (n) => (n > 0 ? Math.floor(Math.log2(n)) + 1 : 0);
export function modesFromSetup(setup, channels) {
  if (setup.subarray(0, 7).toString("hex") !== "05766f72626973")
    throw new Error("setup包签名无效");
  const r = new Bits(setup);
  r.skip(56);
  const books = r.read(8) + 1;
  for (let i = 0; i < books; i++) {
    if (r.read(24) !== 0x564342) throw new Error("codebook签名无效");
    const dimensions = r.read(16),
      entries = r.read(24);
    if (!dimensions || !entries) throw new Error("codebook尺寸无效");
    if (r.read(1)) {
      let consumed = 0,
        length = r.read(5) + 1;
      while (consumed < entries) {
        const count = r.read(ilog(entries - consumed));
        if (count > entries - consumed || length > 64)
          throw new Error("ordered codebook无效");
        consumed += count;
        length++;
      }
    } else {
      const sparse = r.read(1);
      for (let e = 0; e < entries; e++) if (!sparse || r.read(1)) r.skip(5);
    }
    const lookup = r.read(4);
    if (lookup > 2) throw new Error("codebook lookup无效");
    if (lookup) {
      r.skip(64);
      const valueBits = r.read(4) + 1;
      r.skip(1);
      let values = entries * dimensions;
      if (lookup === 1) {
        values = Math.floor(entries ** (1 / dimensions));
        while ((values + 1) ** dimensions <= entries) values++;
        while (values ** dimensions > entries) values--;
      }
      r.skip(values * valueBits);
    }
  }
  const times = r.read(6) + 1;
  for (let i = 0; i < times; i++)
    if (r.read(16) !== 0) throw new Error("time类型无效");
  const floors = r.read(6) + 1;
  for (let i = 0; i < floors; i++) {
    const type = r.read(16);
    if (type === 0) {
      r.skip(8 + 16 + 16 + 6 + 8);
      const books = r.read(4) + 1;
      r.skip(books * 8);
    } else if (type === 1) {
      const partitions = r.read(5),
        classes = [];
      for (let j = 0; j < partitions; j++) classes.push(r.read(4));
      const dimensions = [];
      for (let j = 0; j <= Math.max(-1, ...classes); j++) {
        dimensions[j] = r.read(3) + 1;
        const subclasses = r.read(2);
        if (subclasses) r.skip(8);
        r.skip(8 * (1 << subclasses));
      }
      r.skip(2);
      const range = r.read(4);
      for (const cl of classes) r.skip(dimensions[cl] * range);
    } else throw new Error("floor类型无效");
  }
  const residues = r.read(6) + 1;
  for (let i = 0; i < residues; i++) {
    if (r.read(16) > 2) throw new Error("residue类型无效");
    r.skip(72);
    const count = r.read(6) + 1;
    r.skip(8);
    const cascade = [];
    for (let j = 0; j < count; j++) {
      const low = r.read(3),
        high = r.read(1) ? r.read(5) : 0;
      cascade.push(low | (high << 3));
    }
    for (const flags of cascade)
      for (let j = 0; j < 8; j++) if (flags & (1 << j)) r.skip(8);
  }
  const mappings = r.read(6) + 1;
  for (let i = 0; i < mappings; i++) {
    if (r.read(16) !== 0) throw new Error("mapping类型无效");
    const submaps = r.read(1) ? r.read(4) + 1 : 1;
    if (r.read(1)) {
      const count = r.read(8) + 1;
      for (let j = 0; j < count; j++) r.skip(2 * ilog(channels - 1));
    }
    if (r.read(2) !== 0) throw new Error("mapping保留位无效");
    if (submaps > 1) r.skip(channels * 4);
    r.skip(submaps * 24);
  }
  const count = r.read(6) + 1,
    flags = [];
  for (let i = 0; i < count; i++) {
    flags.push(r.read(1));
    if (r.read(16) || r.read(16)) throw new Error("mode窗口/变换无效");
    r.skip(8);
  }
  if (r.read(1) !== 1) throw new Error("setup framing bit无效");
  return { flags, bits: ilog(count - 1), consumedBits: r.pos };
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i << 24;
  for (let j = 0; j < 8; j++)
    n = n & 0x80000000 ? (n << 1) ^ 0x04c11db7 : n << 1;
  return n >>> 0;
});
export function oggCRC(data) {
  let crc = 0;
  for (const byte of data)
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]) >>> 0;
  return crc;
}
export function oggPage(
  packet,
  number,
  granule,
  { bos = false, eos = false, serial = 1 } = {},
) {
  const segments = Array(Math.floor(packet.length / 255)).fill(255);
  segments.push(packet.length % 255);
  if (segments.length > 255) throw new Error("单包过大，需分页面");
  const header = Buffer.alloc(27 + segments.length);
  header.write("OggS");
  header[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  header.writeBigUInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(number, 18);
  header[26] = segments.length;
  Buffer.from(segments).copy(header, 27);
  const result = Buffer.concat([header, packet]);
  result.writeUInt32LE(oggCRC(result), 22);
  return result;
}
function fsbInfo(data) {
  if (
    data.toString("ascii", 0, 4) !== "FSB5" ||
    data.readUInt32LE(4) !== 1 ||
    data.readUInt32LE(8) !== 1 ||
    data.readUInt32LE(24) !== 15
  )
    throw new Error("仅支持已确认的单sample FSB5/v1/Vorbis");
  const header = data.readBigUInt64LE(60),
    samples = Number(header >> 34n),
    dataOffset = Number((header >> 6n) & 0xfffffffn) * 16;
  let p = 68,
    more = Boolean(header & 1n),
    setupID = null;
  while (more) {
    const raw = data.readUInt32LE(p);
    p += 4;
    const size = (raw >>> 1) & 0xffffff,
      type = raw >>> 25;
    more = Boolean(raw & 1);
    if (type === 11) setupID = data.readUInt32LE(p);
    p += size;
  }
  if (setupID === null) throw new Error("缺setupID");
  const start = 60 + data.readUInt32LE(12) + data.readUInt32LE(16) + dataOffset,
    end =
      60 +
      data.readUInt32LE(12) +
      data.readUInt32LE(16) +
      data.readUInt32LE(20),
    packets = [];
  p = start;
  while (p + 2 <= end) {
    const size = data.readUInt16LE(p);
    p += 2;
    if (!size) break;
    if (p + size > end) throw new Error("音频包越界");
    packets.push(data.subarray(p, p + size));
    p += size;
  }
  return { setupID, samples, packets, dataOffset };
}
export function repackVorbis(data, clip, setup) {
  const source = fsbInfo(data);
  if (crc32(setup) !== source.setupID)
    throw new Error("Vorbis setup CRC32 与 FSB5 不符");
  const mode = modesFromSetup(setup, clip.channels),
    identity = Buffer.alloc(30);
  identity[0] = 1;
  identity.write("vorbis", 1);
  identity[11] = clip.channels;
  identity.writeUInt32LE(clip.frequency, 12);
  identity[28] = 0xb8;
  identity[29] = 1;
  const vendor = Buffer.from("Original Gorogoa FSB5 repack"),
    comment = Buffer.alloc(7 + 4 + vendor.length + 4 + 1);
  comment[0] = 3;
  comment.write("vorbis", 1);
  comment.writeUInt32LE(vendor.length, 7);
  vendor.copy(comment, 11);
  comment[comment.length - 1] = 1;
  let seq = 0,
    position = 0,
    previous = 0;
  const pages = [
    oggPage(identity, seq++, 0, { bos: true }),
    oggPage(comment, seq++, 0),
    oggPage(setup, seq++, 0),
  ];
  for (let i = 0; i < source.packets.length; i++) {
    const packet = source.packets[i],
      r = new Bits(packet);
    if (r.read(1) !== 0) throw new Error("非音频包");
    const index = r.read(mode.bits);
    if (index >= mode.flags.length) throw new Error("音频mode越界");
    const block = mode.flags[index] ? 2048 : 256;
    if (previous) position += (previous + block) / 4;
    previous = block;
    const eos = i === source.packets.length - 1;
    pages.push(
      oggPage(
        packet,
        seq++,
        eos ? source.samples : Math.min(source.samples, position),
        { eos },
      ),
    );
  }
  return {
    bytes: Buffer.concat(pages),
    setupID: source.setupID,
    samples: source.samples,
    packets: source.packets.length,
    modes: mode,
  };
}
function main() {
  const directory = path.join(root, "public/assets/audio");
  const manifestPath = path.join(directory, "manifest.json");
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""))
    : { clips: [] };
  const verified = new Map(
    previous.clips
      .filter((clip) => clip.browserDecodeVerified)
      .map((clip) => [clip.key, clip]),
  );
  const inventory = JSON.parse(
    fs.readFileSync(path.join(root, "work/audio-inventory.json")),
  );
  const player = fs.readFileSync(
    "E:/SteamLibrary/steamapps/common/Gorogoa/UnityPlayer.dll",
  );
  const containerSha256 = hash(player);
  const setups = new Map();
  const selected = process.argv.includes("--samples")
    ? inventory.clips
        .filter((clip) =>
          /UI_Card_PickUp_04|UI_Menu_Back_02|Transition_IntoApt|Amb_Chapter1|Page|page|Book/i.test(
            clip.name,
          ),
        )
        .slice(0, 12)
    : inventory.clips;
  const clips = [];
  const failures = [];
  fs.mkdirSync(directory, { recursive: true });

  for (const clip of selected) {
    try {
      const fd = fs.openSync(clip.stream, "r");
      const raw = Buffer.alloc(clip.size);
      try {
        if (fs.readSync(fd, raw, 0, raw.length, clip.offset) !== raw.length)
          throw new Error("原始流不完整");
      } finally {
        fs.closeSync(fd);
      }
      if (hash(raw) !== clip.dataSha256) throw new Error("原始流哈希变化");
      const { setupID } = fsbInfo(raw);
      if (!setups.has(setupID))
        setups.set(setupID, readUnityVorbisSetup(player, setupID));
      const { bytes: setup, source } = setups.get(setupID);
      const result = repackVorbis(raw, clip, setup);
      const filename = `${clip.asset.replace(/\W/g, "-")}-${clip.pathId}-${clip.name.replace(/[^a-zA-Z0-9_.-]/g, "_")}.ogg`;
      const outputSha256 = hash(result.bytes);
      const verifiedClip = verified.get(clip.key);
      const browserDecodeVerified = verifiedClip?.outputSha256 === outputSha256;
      fs.writeFileSync(path.join(directory, filename), result.bytes);
      clips.push({
        ...clip,
        url: `assets/audio/${filename}`,
        outputSha256,
        setupID: setupID.toString(16).padStart(8, "0"),
        setupSource: {
          file: "UnityPlayer.dll",
          containerSha256,
          ...source,
          sha256: hash(setup),
        },
        samples: result.samples,
        packetCount: result.packets,
        durationExpected: result.samples / clip.frequency,
        codec: "Vorbis in Ogg",
        browserDecodeVerified,
        ...(browserDecodeVerified
          ? { browserVerification: verifiedClip.browserVerification }
          : {}),
      });
    } catch (error) {
      failures.push({ key: clip.key, name: clip.name, error: error.message });
    }
  }

  const output = {
    scope:
      "Original FSB5 packets remuxed with CRC32-matched UnityPlayer Vorbis setup packets",
    clips,
    failures,
  };
  fs.writeFileSync(
    path.join(root, "work/audio-export.json"),
    JSON.stringify(output, null, 2),
  );
  fs.writeFileSync(manifestPath, JSON.stringify(output, null, 2));
  console.log(
    JSON.stringify({
      selected: selected.length,
      exported: clips.length,
      failures,
    }),
  );
  if (failures.length) process.exitCode = 1;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main();
