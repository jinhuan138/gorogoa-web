import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { crc32 } from 'node:zlib';
import { modesFromSetup, oggCRC, readUnityVorbisSetup } from './export-audio.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/audio/manifest.json', import.meta.url)));
const player = fs.readFileSync('E:/SteamLibrary/steamapps/common/Gorogoa/UnityPlayer.dll');
const setups = new Map();
let pages = 0;

for (const clip of manifest.clips) {
  const id = Number.parseInt(clip.setupID, 16);
  if (!setups.has(id)) setups.set(id, readUnityVorbisSetup(player, id).bytes);
  const data = fs.readFileSync(new URL(`../public/${clip.url}`, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), clip.outputSha256);
  let offset = 0;
  let sequence = 0;
  let lastGranule = 0n;
  while (offset < data.length) {
    assert.equal(data.toString('ascii', offset, offset + 4), 'OggS');
    const headerSize = 27 + data[offset + 26];
    const lace = data.subarray(offset + 27, offset + headerSize);
    const packetSize = lace.reduce((sum, value) => sum + value, 0);
    const next = offset + headerSize + packetSize;
    const page = Buffer.from(data.subarray(offset, next));
    const stored = page.readUInt32LE(22);
    page.fill(0, 22, 26);
    assert.equal(oggCRC(page), stored);
    assert.equal(page.readUInt32LE(18), sequence);
    const granule = page.readBigUInt64LE(6);
    assert.ok(granule >= lastGranule, clip.name);
    lastGranule = granule;
    assert.ok(sequence !== 0 || page[5] & 2);
    if (next === data.length) assert.ok(page[5] & 4);
    assert.ok(lace.at(-1) < 255);
    if (sequence === 2) {
      const setup = page.subarray(headerSize);
      assert.equal(crc32(setup), id, clip.name);
      assert.deepEqual(setup, setups.get(id), clip.name);
      assert.ok(modesFromSetup(setup, clip.channels).flags.length > 0);
    }
    sequence++;
    pages++;
    offset = next;
  }
  assert.equal(sequence, clip.packetCount + 3, clip.name);
  assert.equal(Number(lastGranule), clip.samples);
  assert.equal(offset, data.length);
  assert.equal(clip.durationExpected, clip.samples / clip.frequency);
}

console.log(`音频检查通过：${manifest.clips.length} 个文件、${pages} 页、${setups.size} 种与原版 FSB5 匹配的解码头。`);

