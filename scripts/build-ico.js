/**
 * Build a multi-size ICO file from individual PNG files.
 * Embeds 16, 32, 48, 64, 128, 256 px PNGs into a single .ico.
 *
 * Usage: node scripts/build-ico.js
 */
const fs = require("fs");
const path = require("path");

const iconsDir = path.join(__dirname, "..", "assets", "icons");
const sizes = [16, 32, 48, 64, 128, 256];

const pngFiles = sizes.map((s) => {
  const filePath = path.join(iconsDir, `icon-${s}.png`);
  return { size: s, data: fs.readFileSync(filePath) };
});

// ICO file format:
//   ICONDIR (6 bytes)
//   ICONDIRENTRY[n] (16 bytes each)
//   PNG data for each entry

const numImages = pngFiles.length;
const headerSize = 6;
const entrySize = 16;
const dirSize = headerSize + entrySize * numImages;

// Calculate offsets
let offset = dirSize;
const entries = pngFiles.map((pf) => {
  const entry = {
    width: pf.size >= 256 ? 0 : pf.size,    // 0 means 256+
    height: pf.size >= 256 ? 0 : pf.size,
    dataSize: pf.data.length,
    offset: offset,
    data: pf.data,
  };
  offset += pf.data.length;
  return entry;
});

// Build the ICO buffer
const totalSize = offset;
const buf = Buffer.alloc(totalSize);

// ICONDIR header
buf.writeUInt16LE(0, 0);           // Reserved
buf.writeUInt16LE(1, 2);           // Type: 1 = ICO
buf.writeUInt16LE(numImages, 4);   // Number of images

// ICONDIRENTRY entries
entries.forEach((entry, i) => {
  const pos = headerSize + i * entrySize;
  buf.writeUInt8(entry.width, pos);          // Width
  buf.writeUInt8(entry.height, pos + 1);     // Height
  buf.writeUInt8(0, pos + 2);               // Color palette (0 = none)
  buf.writeUInt8(0, pos + 3);               // Reserved
  buf.writeUInt16LE(1, pos + 4);            // Color planes
  buf.writeUInt16LE(32, pos + 6);           // Bits per pixel
  buf.writeUInt32LE(entry.dataSize, pos + 8);  // Data size
  buf.writeUInt32LE(entry.offset, pos + 12);   // Data offset
});

// Write PNG data
entries.forEach((entry) => {
  entry.data.copy(buf, entry.offset);
});

const outPath = path.join(iconsDir, "icon.ico");
fs.writeFileSync(outPath, buf);
console.log(`ICO created: ${outPath} (${buf.length} bytes, ${numImages} images)`);
