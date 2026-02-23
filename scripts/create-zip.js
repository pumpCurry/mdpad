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

// Read build number
let buildNumber = 1;
try {
  const buildData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build-number.json"), "utf-8"));
  buildNumber = buildData.build || 1;
} catch {}
const [major, minor] = pkg.version.split(".");
const versionTag = `v${major}.${minor}.${String(buildNumber).padStart(5, "0")}`;

// Read build output directory from electron-builder.yml
let ebOutput = "build";
try {
  const ymlPath = path.join(__dirname, "..", "electron-builder.yml");
  const ymlContent = fs.readFileSync(ymlPath, "utf-8");
  const match = ymlContent.match(/^\s*output:\s*(.+)/m);
  if (match) ebOutput = match[1].trim();
} catch {}
const buildDir = path.join(__dirname, "..", ebOutput, "win-unpacked");
const outputDir = path.dirname(buildDir);
const zipName = `mdpad-${versionTag}-win-x64-portable.zip`;
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
