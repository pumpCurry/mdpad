/**
 * Create a portable zip release from the electron-builder dir output.
 * Uses Node.js built-in zlib + archiver-like manual zip creation.
 *
 * Since we don't want to add archiver as a dependency, we use
 * a simple approach: call PowerShell's Compress-Archive on Windows.
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const pkg = require("../package.json");

// Auto-detect build output directory (build4/ or build3/ or build2/ or build/)
const buildDir4 = path.join(__dirname, "..", "build4", "win-unpacked");
const buildDir3 = path.join(__dirname, "..", "build3", "win-unpacked");
const buildDir2 = path.join(__dirname, "..", "build2", "win-unpacked");
const buildDir1 = path.join(__dirname, "..", "build", "win-unpacked");
const buildDir = fs.existsSync(buildDir4) ? buildDir4 : fs.existsSync(buildDir3) ? buildDir3 : fs.existsSync(buildDir2) ? buildDir2 : buildDir1;
const outputDir = path.dirname(buildDir);
const zipName = `mdpad-v${pkg.version}-win-x64-portable.zip`;
const zipPath = path.join(outputDir, zipName);

if (!fs.existsSync(buildDir)) {
  console.error("Error: build/win-unpacked not found. Run 'npm run build' first.");
  process.exit(1);
}

// Remove existing zip if present
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log(`Creating portable zip: ${zipName}`);

// Use PowerShell Compress-Archive (available on Windows 10+)
try {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${buildDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal"`,
    { stdio: "inherit" }
  );
  console.log(`Created: ${zipPath}`);

  const stats = fs.statSync(zipPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`Size: ${sizeMB} MB`);
} catch (err) {
  console.error("Failed to create zip:", err.message);
  process.exit(1);
}
