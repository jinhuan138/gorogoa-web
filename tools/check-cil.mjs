import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const methods = JSON.parse(fs.readFileSync(path.join(root, 'work/cil-selected.json')));
const camera = methods.find(m => m.owner === '_Camera' && m.name === 'cameraToProjected');
assert.ok(camera);
for (const offset of [30, 35, 40]) { const i = camera.body.instructions.find(i => i.offset === offset); assert.equal(i.opcode, 'ldc.r4'); assert.equal(i.operand.value, 'NaN'); assert.equal(i.operand.bits, '0000c0ff'); }
const bounds = methods.find(m => m.owner === '_Camera' && m.name === 'getProjectedBounds');
for (const offset of [0, 6]) assert.equal(bounds.body.instructions.find(i => i.offset === offset).operand.value, 'Infinity');
for (const offset of [12, 18]) assert.equal(bounds.body.instructions.find(i => i.offset === offset).operand.value, '-Infinity');
const initial = methods.find(m => m.owner === 'StateContainer' && m.name === 'getInitialState'); assert.ok(initial.body.instructions.some(i => i.operand?.name === 'StateContainer.getStates'));
const assembly = fs.readFileSync('E:/SteamLibrary/steamapps/common/Gorogoa/Gorogoa_Data/Managed/Assembly-CSharp.dll');
for (const m of methods) {
  const body = m.body; if (!body) continue;
  const offsets = new Set(body.instructions.map(i => i.offset)); offsets.add(body.size);
  for (const i of body.instructions) {
    if (i.opcode.startsWith('ldc.r') && i.operand?.kind === 'float') { const prefix = assembly[body.codeOffset + i.offset] === 0xfe ? 2 : 1; assert.equal(assembly.subarray(body.codeOffset + i.offset + prefix, body.codeOffset + i.offset + prefix + i.operand.precision / 8).toString('hex'), i.operand.bits); }
    if (Array.isArray(i.operand)) for (const target of i.operand) assert.ok(offsets.has(target), `${m.owner}.${m.name}: switch target ${target}`);
    else if (/^(br|beq|bne|bge|bgt|ble|blt|leave)/.test(i.opcode) && typeof i.operand === 'number') assert.ok(offsets.has(i.operand), `${m.owner}.${m.name}: branch target ${i.operand}`);
  }
}
console.log(`CIL 检查通过：${methods.length} 个方法的分支边界，原版 NaN/Infinity 标记及其字节保留。尚未恢复 EH/局部变量签名/泛型实例参数。`);
