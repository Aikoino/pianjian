// 生成 256x256 PNG 应用图标（纯色圆角方块 + "片"字）
const fs = require('fs');
const zlib = require('zlib');

const SIZE = 256;

// 创建像素数据 (RGBA)
const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

// 背景：暖黄色圆角方形
const bg = [0xF0, 0xEF, 0xE9, 0xFF]; // #f0efe9
const fg = [0xB7, 0x1C, 0x1C, 0xFF]; // #b71c1c (daily red)
const radius = 48;
const margin = 16;

function isInRoundedRect(x, y) {
  const w = SIZE - margin * 2;
  const h = SIZE - margin * 2;
  const rx = x - margin;
  const ry = y - margin;
  if (rx < 0 || rx >= w || ry < 0 || ry >= h) return false;

  // 四个角
  if (rx < radius && ry < radius) {
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  }
  if (rx >= w - radius && ry < radius) {
    const dx = rx - (w - radius);
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  }
  if (rx < radius && ry >= h - radius) {
    const dx = radius - rx;
    const dy = ry - (h - radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  if (rx >= w - radius && ry >= h - radius) {
    const dx = rx - (w - radius);
    const dy = ry - (h - radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

// 填充背景色
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;
    if (isInRoundedRect(x, y)) {
      pixels[idx] = fg[0];
      pixels[idx + 1] = fg[1];
      pixels[idx + 2] = fg[2];
      pixels[idx + 3] = fg[3];
    } else {
      pixels[idx] = 0;
      pixels[idx + 1] = 0;
      pixels[idx + 2] = 0;
      pixels[idx + 3] = 0;
    }
  }
}

// 筛选器: 无
function createPng(width, height, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  // compression/filter/interlace
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT: raw pixel data with filter byte per row
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // no filter
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSig(), ihdrChunk, idatChunk, iendChunk]);
}

function pngSig() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

fs.writeFileSync(`${__dirname}/icon.png`, createPng(SIZE, SIZE, pixels));
console.log('icon.png generated');
