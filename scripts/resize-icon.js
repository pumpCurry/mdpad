/**
 * Generate app icons from the source image.
 * Crops to square, then produces multiple sizes for best quality.
 *
 * Usage: npx electron scripts/resize-icon.js
 */
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(() => {
  const srcPath = path.join(__dirname, "..", "assets", "icons", "mdpad_icon.png");
  const iconsDir = path.join(__dirname, "..", "assets", "icons");

  const img = nativeImage.createFromPath(srcPath);
  const size = img.getSize();
  console.log("Source:", size.width + "x" + size.height);

  // Crop to square (center crop to the smaller dimension)
  const side = Math.min(size.width, size.height);
  const cropX = Math.floor((size.width - side) / 2);
  const cropY = Math.floor((size.height - side) / 2);
  const cropped = img.crop({ x: cropX, y: cropY, width: side, height: side });
  const croppedSize = cropped.getSize();
  console.log("Cropped:", croppedSize.width + "x" + croppedSize.height);

  // Generate multiple sizes for ICO embedding
  const sizes = [16, 32, 48, 64, 128, 256];
  for (const s of sizes) {
    const resized = cropped.resize({ width: s, height: s, quality: "best" });
    const pngBuf = resized.toPNG();
    const outPath = path.join(iconsDir, `icon-${s}.png`);
    fs.writeFileSync(outPath, pngBuf);
    console.log(`  ${s}x${s} -> ${outPath} (${pngBuf.length} bytes)`);
  }

  // Main icon (256x256) — used by electron-builder
  const main256 = cropped.resize({ width: 256, height: 256, quality: "best" });
  const mainBuf = main256.toPNG();
  const mainPath = path.join(iconsDir, "icon.png");
  fs.writeFileSync(mainPath, mainBuf);
  console.log(`\nMain icon: ${mainPath} (${mainBuf.length} bytes)`);

  // Also generate 512x512 for extra quality
  const main512 = cropped.resize({ width: 512, height: 512, quality: "best" });
  const buf512 = main512.toPNG();
  const path512 = path.join(iconsDir, "icon-512.png");
  fs.writeFileSync(path512, buf512);
  console.log(`512x512: ${path512} (${buf512.length} bytes)`);

  app.quit();
});
