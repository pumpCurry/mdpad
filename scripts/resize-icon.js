/**
 * Resize the app icon to 256x256 for Electron builder.
 * Uses Electron's nativeImage for high-quality resizing.
 *
 * Usage: npx electron scripts/resize-icon.js
 */
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(() => {
  const srcPath = path.join(__dirname, "..", "assets", "icons", "mdpad_icon.png");
  const destPath = path.join(__dirname, "..", "assets", "icons", "icon.png");

  const img = nativeImage.createFromPath(srcPath);
  const size = img.getSize();
  console.log("Source:", size.width + "x" + size.height);

  // Resize to 256x256
  const resized = img.resize({ width: 256, height: 256, quality: "best" });
  const resizedSize = resized.getSize();
  console.log("Resized:", resizedSize.width + "x" + resizedSize.height);

  const pngBuf = resized.toPNG();
  fs.writeFileSync(destPath, pngBuf);
  console.log("Saved:", destPath, "(" + pngBuf.length + " bytes)");

  app.quit();
});
