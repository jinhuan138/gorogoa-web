// BC1/BC3 首层解码。只接受完整块；不修改原始压缩字节。
export function decodeDxt(input, width, height, format) {
  if (![10, 12].includes(format)) throw new Error("仅支持 BC1 / BC3");
  const blockSize = format === 10 ? 8 : 16,
    blocksX = Math.ceil(width / 4),
    blocksY = Math.ceil(height / 4);
  if (input.length < blocksX * blocksY * blockSize)
    throw new Error("压缩纹理块不完整");
  const output = Buffer.alloc(width * height * 4);
  const rgb = (value) => [
    Math.round((((value >>> 11) & 31) * 255) / 31),
    Math.round((((value >>> 5) & 63) * 255) / 63),
    Math.round(((value & 31) * 255) / 31),
    255,
  ];
  for (let by = 0; by < blocksY; by++)
    for (let bx = 0; bx < blocksX; bx++) {
      const block = (by * blocksX + bx) * blockSize,
        color = block + (format === 12 ? 8 : 0);
      const c0 = input.readUInt16LE(color),
        c1 = input.readUInt16LE(color + 2),
        palette = [rgb(c0), rgb(c1)];
      if (c0 > c1 || format === 12) {
        palette.push(
          palette[0].map((v, i) =>
            i === 3 ? 255 : Math.floor((2 * v + palette[1][i]) / 3),
          ),
        );
        palette.push(
          palette[0].map((v, i) =>
            i === 3 ? 255 : Math.floor((v + 2 * palette[1][i]) / 3),
          ),
        );
      } else {
        palette.push(
          palette[0].map((v, i) =>
            i === 3 ? 255 : Math.floor((v + palette[1][i]) / 2),
          ),
        );
        palette.push([0, 0, 0, 0]);
      }
      let selectors = input.readUInt32LE(color + 4),
        alphaBits = 0,
        alphas = [];
      if (format === 12) {
        const a0 = input[block],
          a1 = input[block + 1];
        alphas = [a0, a1];
        if (a0 > a1) {
          for (let j = 1; j <= 6; j++)
            alphas.push(Math.floor(((7 - j) * a0 + j * a1) / 7));
        } else {
          for (let j = 1; j <= 4; j++)
            alphas.push(Math.floor(((5 - j) * a0 + j * a1) / 5));
          alphas.push(0, 255);
        }
        alphaBits = input.readUIntLE(block + 2, 6);
      }
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4),
          y = by * 4 + Math.floor(i / 4),
          colorValue = palette[selectors & 3];
        selectors >>>= 2;
        const alpha = format === 12 ? alphas[alphaBits % 8] : colorValue[3];
        if (format === 12) alphaBits = Math.floor(alphaBits / 8);
        if (x < width && y < height) {
          const p = (y * width + x) * 4;
          output[p] = colorValue[0];
          output[p + 1] = colorValue[1];
          output[p + 2] = colorValue[2];
          output[p + 3] = alpha;
        }
      }
    }
  return output;
}
