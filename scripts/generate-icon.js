#!/usr/bin/env node
/**
 * generate-icon.js
 * Generates a 256x256 PNG icon for mdpad (a Markdown editor).
 * Uses only Node.js built-ins (zlib, fs, buffer) - no external dependencies.
 *
 * Design: rounded dark-blue square with "MD" in white, sky-blue accent bar,
 *         and a small pencil motif.
 */

'use strict';
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

const W = 256, H = 256;

// -- Colour palette -----------------------------------------------------------
const BG        = [30,  41,  59 ];   // slate-800
const FG        = [248, 250, 252];   // slate-50
const ACCENT    = [56, 189, 248];   // sky-400
const CORNER_BG = [15,  23,  42 ];   // slate-900

// -- Helpers ------------------------------------------------------------------
function inRoundedRect(x, y, x0, y0, w, h, r) {
  const rx = x - x0, ry = y - y0;
  if (rx < 0 || ry < 0 || rx >= w || ry >= h) return false;
  const corners = [
    [r,       r      ],
    [w - r-1, r      ],
    [r,       h - r-1],
    [w - r-1, h - r-1],
  ];
  for (const [cx, cy] of corners) {
    const dx = rx - cx, dy = ry - cy;
    const inCornerBox =
      (rx < r && ry < r) ||
      (rx >= w - r && ry < r) ||
      (rx < r && ry >= h - r) ||
      (rx >= w - r && ry >= h - r);
    if (inCornerBox && dx * dx + dy * dy > r * r) return false;
  }
  return true;
}

const GLYPHS = {
  M: [
    '#...#',
    '##.##',
    '#.#.#',
    '#.#.#',
    '#...#',
    '#...#',
    '#...#',
  ],
  D: [
    '####.',
    '#..##',
    '#...#',
    '#...#',
    '#...#',
    '#..##',
    '####.',
  ],
};

function drawGlyph(pixels, glyph, originX, originY, scale, color) {
  const rows = GLYPHS[glyph];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (rows[gy][gx] !== '#') continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = originX + gx * scale + sx;
          const py = originY + gy * scale + sy;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            const idx = (py * W + px) * 3;
            pixels[idx]     = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
          }
        }
      }
    }
  }
}

function fillRect(pixels, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const idx = (y * W + x) * 3;
        pixels[idx]     = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
      }
    }
  }
}

function drawPencil(pixels, cx, cy, len, color) {
  for (let i = 0; i < len; i++) {
    const x = cx - i;
    const y = cy - i;
    for (let t = -1; t <= 1; t++) {
      const px = x + t;
      const py = y - t;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const idx = (py * W + px) * 3;
        pixels[idx]     = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
      }
    }
  }
}

// -- Build the image ----------------------------------------------------------
const pixels = Buffer.alloc(W * H * 3);

// 1. Background: rounded rectangle
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 3;
    if (inRoundedRect(x, y, 0, 0, W, H, 36)) {
      pixels[idx]     = BG[0];
      pixels[idx + 1] = BG[1];
      pixels[idx + 2] = BG[2];
    } else {
      pixels[idx]     = CORNER_BG[0];
      pixels[idx + 1] = CORNER_BG[1];
      pixels[idx + 2] = CORNER_BG[2];
    }
  }
}

// 2. Draw "MD" text (scale 10 -> each glyph 50x70 px)
const scale = 10;
const glyphW = 5 * scale;
const glyphH = 7 * scale;
const gap = 8;
const totalW = glyphW * 2 + gap;
const textX = Math.floor((W - totalW) / 2);
const textY = Math.floor((H - glyphH) / 2) - 12;

drawGlyph(pixels, 'M', textX,                textY, scale, FG);
drawGlyph(pixels, 'D', textX + glyphW + gap, textY, scale, FG);

// 3. Accent underline bar
const barY = textY + glyphH + 10;
const barH = 6;
fillRect(pixels, textX, barY, totalW, barH, ACCENT);

// 4. Small pencil accent bottom-right
drawPencil(pixels, W - 38, H - 38, 28, ACCENT);

// -- Encode PNG ---------------------------------------------------------------
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0);
ihdrData.writeUInt32BE(H, 4);
ihdrData[8]  = 8;   // bit depth
ihdrData[9]  = 2;   // colour type RGB
ihdrData[10] = 0;   // compression
ihdrData[11] = 0;   // filter
ihdrData[12] = 0;   // interlace

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowOff = y * (1 + W * 3);
  raw[rowOff] = 0;  // filter: None
  pixels.copy(raw, rowOff + 1, y * W * 3, (y + 1) * W * 3);
}

const compressed = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),   // PNG signature
  pngChunk('IHDR', ihdrData),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);

const kb = (png.length / 1024).toFixed(1);
console.log('Wrote ' + outPath + '  (' + W + 'x' + H + ', ' + kb + ' KB)');
