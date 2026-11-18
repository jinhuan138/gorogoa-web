import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] || 'E:/SteamLibrary/steamapps/common/Gorogoa/Gorogoa_Data/Managed/Assembly-CSharp.dll';
const filter = new RegExp(process.argv[3] || '^(ImageLayer|LayeredImage|LayeredImageGraphic|LocationLayerGraphic|SceneLocation|SceneLocationLayer|SceneLayer|StandardViewpoint|SimpleViewpoint|VirtualTexture|PackedTextures|ParallaxLayer|GlobalToViewportTransform|ViewportTransform|SceneLocationRenderer|RectTransformData|CardStateManager|AtomicPredicate|CompoundPredicate)$');
const b = fs.readFileSync(source); const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
class Reader {
  constructor(pos = 0) { this.pos = pos; }
  u8() { return b.readUInt8(this.pos++); }
  u16() { const value = b.readUInt16LE(this.pos); this.pos += 2; return value; }
  u32() { const value = b.readUInt32LE(this.pos); this.pos += 4; return value; }
  index(size) { return size === 4 ? this.u32() : this.u16(); }
  align() { this.pos = Math.ceil(this.pos / 4) * 4; }
  str() { const end = b.indexOf(0, this.pos); if (end < 0) throw new Error('字符串未终止'); const value = b.toString('utf8', this.pos, end); this.pos = end + 1; return value; }
}
const pe = b.readUInt32LE(0x3c), optional = pe + 24, sections = [], sectionStart = optional + b.readUInt16LE(pe + 20);
for (let i = 0; i < b.readUInt16LE(pe + 6); i++) { const p = sectionStart + i * 40; sections.push({ va: b.readUInt32LE(p + 12), size: Math.max(b.readUInt32LE(p + 8), b.readUInt32LE(p + 16)), raw: b.readUInt32LE(p + 20) }); }
const fileOffset = rva => { const section = sections.find(s => rva >= s.va && rva < s.va + s.size); if (!section) throw new Error(`RVA 没有映射 ${rva}`); return section.raw + rva - section.va; };
const directory = optional + (b.readUInt16LE(optional) === 0x10b ? 96 : 112), cli = fileOffset(b.readUInt32LE(directory + 14 * 8));
const metadata = fileOffset(b.readUInt32LE(cli + 8)); let r = new Reader(metadata);
if (r.u32() !== 0x424a5342) throw new Error('不是 CLR 元数据'); r.pos += 8; const versionLength = r.u32(); r.pos += versionLength; r.align(); r.u16(); const streams = {};
for (let i = 0, count = r.u16(); i < count; i++) { const offset = r.u32(), size = r.u32(), name = r.str(); r.align(); streams[name] = { offset: metadata + offset, size }; }
r = new Reader((streams['#~'] || streams['#-']).offset); r.pos += 6; const heapFlags = r.u8(); r.u8(); const valid = b.readBigUInt64LE(r.pos); r.pos += 16; const rows = Array(64).fill(0);
for (let i = 0; i < 64; i++) if (valid & (1n << BigInt(i))) rows[i] = r.u32();
const stringSize = heapFlags & 1 ? 4 : 2, guidSize = heapFlags & 2 ? 4 : 2, blobSize = heapFlags & 4 ? 4 : 2;
const idx = n => rows[n] >= 65536 ? 4 : 2;
const coded = (tables, bits) => Math.max(...tables.map(t => rows[t])) >= 2 ** (16 - bits) ? 4 : 2;
const tdor = coded([2, 1, 27], 2), scope = coded([0, 26, 35, 1], 2), parent = coded([2, 1, 26, 6, 27], 3);
const sizes = [2 + stringSize + guidSize * 3, scope + stringSize * 2, 4 + stringSize * 2 + tdor + idx(4) + idx(6), idx(4), 2 + stringSize + blobSize, idx(6), 8 + stringSize + blobSize + idx(8), idx(8), 4 + stringSize, idx(2) + tdor, parent + stringSize + blobSize, 2 + coded([4, 8, 23], 2) + blobSize];
const starts = []; let cursor = r.pos; for (let i = 0; i < sizes.length; i++) { starts[i] = cursor; cursor += rows[i] * sizes[i]; }
const string = index => { const p = streams['#Strings'].offset + index, end = b.indexOf(0, p); return b.toString('utf8', p, end); };
function compressed(position) { const first = b[position]; if (first < 128) return [first, 1]; if (first < 192) return [((first & 63) << 8) | b[position + 1], 2]; if (first < 224) return [((first & 31) * 0x1000000) + b.readUIntBE(position + 1, 3), 4]; throw new Error('压缩整数无效'); }
function blob(index) { const p = streams['#Blob'].offset + index, [size, prefix] = compressed(p); return b.subarray(p + prefix, p + prefix + size); }
const typeRefs = [], types = [], fields = [], methods = [], memberRefs = [], constants = [], names = new Map();
const token = (table, row) => table * 0x1000000 + row;
const hex = value => '0x' + value.toString(16).padStart(8, '0');
for (let i = 0; i < rows[1]; i++) { r.pos = starts[1] + i * sizes[1]; const resolutionScope = r.index(scope), name = string(r.index(stringSize)), namespace = string(r.index(stringSize)); const item = { token: token(1, i + 1), name: namespace ? `${namespace}.${name}` : name, resolutionScope }; typeRefs.push(item); names.set(item.token, item.name); }
for (let i = 0; i < rows[2]; i++) { r.pos = starts[2] + i * sizes[2]; const flags = r.u32(), name = string(r.index(stringSize)), namespace = string(r.index(stringSize)), extendsType = r.index(tdor), firstField = r.index(idx(4)), firstMethod = r.index(idx(6)); const item = { token: token(2, i + 1), name: namespace ? `${namespace}.${name}` : name, shortName: name, flags, extendsType, firstField, firstMethod }; types.push(item); names.set(item.token, item.name); }
for (let i = 0; i < rows[4]; i++) { r.pos = starts[4] + i * sizes[4]; const flags = r.u16(), name = string(r.index(stringSize)), signature = blob(r.index(blobSize)).toString('hex'); fields.push({ token: token(4, i + 1), flags, name, signature }); }
for (let i = 0; i < rows[6]; i++) { r.pos = starts[6] + i * sizes[6]; const rva = r.u32(), implFlags = r.u16(), flags = r.u16(), name = string(r.index(stringSize)), signature = blob(r.index(blobSize)).toString('hex'), firstParam = r.index(idx(8)); methods.push({ token: token(6, i + 1), rva, implFlags, flags, name, signature, firstParam }); }
types.forEach((t, i) => { t.fields = fields.slice(t.firstField - 1, (types[i + 1]?.firstField || fields.length + 1) - 1); t.methods = methods.slice(t.firstMethod - 1, (types[i + 1]?.firstMethod || methods.length + 1) - 1); for (const item of [...t.fields, ...t.methods]) { item.owner = t.name; names.set(item.token, `${t.name}.${item.name}`); } });
for (let i = 0; i < rows[10]; i++) { r.pos = starts[10] + i * sizes[10]; const ownerCoded = r.index(parent), name = string(r.index(stringSize)), signature = blob(r.index(blobSize)).toString('hex'); const ownerToken = token([2, 1, 26, 6, 27][ownerCoded & 7], ownerCoded >>> 3); const owner = names.get(ownerToken) || hex(ownerToken); const item = { token: token(10, i + 1), owner, ownerToken, name, signature }; memberRefs.push(item); names.set(item.token, `${owner}.${name}`); }
for (let i = 0; i < rows[11]; i++) { r.pos = starts[11] + i * sizes[11]; const kind = r.u8(); r.u8(); const parentCoded = r.index(coded([4, 8, 23], 2)), valueBytes = blob(r.index(blobSize)), target = token([4, 8, 23][parentCoded & 3], parentCoded >>> 2); let value = valueBytes.toString('hex'); if (kind === 14) value = valueBytes.toString('utf16le'); else if (kind === 2) value = Boolean(valueBytes[0]); else if (kind === 8) value = valueBytes.readInt32LE(); else if (kind === 12) value = valueBytes.readFloatLE(); else if (kind === 13) value = valueBytes.readDoubleLE(); constants.push({ target: hex(target), name: names.get(target), kind, value }); }
const opcodeTable = new Map(JSON.parse(fs.readFileSync(path.join(root, 'work/cil-opcodes.json'), 'utf8').replace(/^\uFEFF/, '')).map(x => [x.code, x]));
function describeToken(value) { if ((value >>> 24) === 0x70) { const p = streams['#US'].offset + (value & 0xffffff), [length, prefix] = compressed(p); return JSON.stringify(b.toString('utf16le', p + prefix, p + prefix + Math.max(0, length - 1))); } return names.get(value) || hex(value); }
function disassemble(method) {
  if (!method.rva || method.implFlags & 3) return null;
  const offset = fileOffset(method.rva), flags = b[offset]; let start, size, locals = 0;
  if ((flags & 3) === 2) { start = offset + 1; size = flags >>> 2; }
  else if ((flags & 3) === 3) { start = offset + ((b.readUInt16LE(offset) >>> 12) * 4); size = b.readUInt32LE(offset + 4); locals = b.readUInt32LE(offset + 8); }
  else throw new Error(`方法体格式无效 ${method.owner}.${method.name}`);
  const instructions = []; let p = start; const end = start + size;
  while (p < end) {
    const position = p - start; let code = b[p++]; if (code === 0xfe) code = 0xfe00 | b[p++]; const op = opcodeTable.get(code); if (!op) throw new Error(`未知 opcode ${hex(code)}`); let operand = null;
    if (op.operand === 'ShortInlineI') { operand = b.readInt8(p); p++; }
    else if (op.operand === 'ShortInlineVar') { operand = b[p++]; }
    else if (op.operand === 'InlineVar') { operand = b.readUInt16LE(p); p += 2; }
    else if (op.operand === 'InlineI') { operand = b.readInt32LE(p); p += 4; }
    else if (op.operand === 'InlineI8') { operand = b.readBigInt64LE(p).toString(); p += 8; }
    else if (op.operand === 'ShortInlineR') { const value = b.readFloatLE(p); operand = Number.isFinite(value) ? value : { kind: 'float', value: String(value), bits: b.subarray(p, p + 4).toString('hex'), precision: 32 }; p += 4; }
    else if (op.operand === 'InlineR') { const value = b.readDoubleLE(p); operand = Number.isFinite(value) ? value : { kind: 'float', value: String(value), bits: b.subarray(p, p + 8).toString('hex'), precision: 64 }; p += 8; }
    else if (op.operand === 'ShortInlineBrTarget') { operand = p + 1 - start + b.readInt8(p); p++; }
    else if (op.operand === 'InlineBrTarget') { operand = p + 4 - start + b.readInt32LE(p); p += 4; }
    else if (op.operand === 'InlineSwitch') { const count = b.readUInt32LE(p); p += 4; const base = p + count * 4 - start; operand = []; for (let j = 0; j < count; j++) { operand.push(base + b.readInt32LE(p)); p += 4; } }
    else if (['InlineField', 'InlineMethod', 'InlineType', 'InlineTok', 'InlineSig', 'InlineString'].includes(op.operand)) { const value = b.readUInt32LE(p); p += 4; operand = { token: hex(value), name: describeToken(value) }; }
    else if (op.operand !== 'InlineNone') throw new Error(`未支持 operand ${op.operand}`);
    if (p > end) throw new Error('操作数超出方法体'); instructions.push({ offset: position, opcode: op.name, operand });
  }
  return { fileOffset: offset, codeOffset: start, size, locals: hex(locals), sha256: sha256(b.subarray(start, end)), instructions };
}
const directoryOut = path.join(root, 'work/cil'); fs.mkdirSync(directoryOut, { recursive: true });
const selected = [];
for (const t of types.filter(t => filter.test(t.shortName))) for (const m of t.methods) { const body = disassemble(m); const result = { ...m, body }; selected.push(result); const filename = `${t.shortName}.${m.name}.${hex(m.token)}.txt`.replace(/[<>:"/\\|?*]/g, '_'); const lines = (body?.instructions || []).map(i => `${i.offset.toString(16).padStart(4, '0')} ${i.opcode.padEnd(14)} ${i.operand === null ? '' : typeof i.operand === 'object' && i.operand.token ? i.operand.name : JSON.stringify(i.operand)}`); fs.writeFileSync(path.join(directoryOut, filename), `${source}\nSHA256 ${sha256(b)}\n${t.name}.${m.name} ${hex(m.token)} RVA ${m.rva}\n${lines.join('\n')}\n`); }
fs.writeFileSync(path.join(root, 'work/cil-index.json'), JSON.stringify({ source, sha256: sha256(b), types, memberRefs, constants }, null, 2));
fs.writeFileSync(path.join(root, 'work/cil-selected.json'), JSON.stringify(selected, null, 2));
console.log(JSON.stringify({ source, sha256: sha256(b), types: types.length, methods: methods.length, constants: constants.length, selectedMethods: selected.length, instructions: selected.reduce((n, m) => n + (m.body?.instructions.length || 0), 0) }));


