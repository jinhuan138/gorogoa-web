import assert from "node:assert/strict";
import { decodeDxt } from "../extract/texture-codecs.mjs";
const red = Buffer.alloc(8);
red.writeUInt16LE(0xf800);
const decoded = decodeDxt(red, 4, 4, 10);
assert.equal(decoded.length, 64);
for (let i = 0; i < 16; i++)
  assert.deepEqual([...decoded.subarray(i * 4, i * 4 + 4)], [255, 0, 0, 255]);
const transparent = Buffer.alloc(8);
transparent.writeUInt16LE(0xffff, 2);
transparent.writeUInt32LE(0xffffffff, 4);
assert.equal(decodeDxt(transparent, 4, 4, 10)[3], 0);
const bc3 = Buffer.alloc(16);
bc3[0] = 255;
bc3[1] = 0;
bc3.writeUInt16LE(0xf800, 8);
assert.deepEqual([...decodeDxt(bc3, 1, 1, 12)], [255, 0, 0, 255]);
bc3[2] = 1;
assert.equal(decodeDxt(bc3, 1, 1, 12)[3], 0);
assert.throws(() => decodeDxt(Buffer.alloc(7), 4, 4, 10), /不完整/);
console.log(
  "纹理解码检查通过：BC1 色值、透明模式、BC3 alpha、边缘尺寸、截断输入",
);
