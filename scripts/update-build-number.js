/**
 * Update build-number.json with the current git commit count + 1.
 * Run before each build to keep the build number in sync.
 *
 * Usage: node scripts/update-build-number.js
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const buildFile = path.join(__dirname, "..", "build-number.json");

let commitCount;
try {
  commitCount = parseInt(
    execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim(),
    10
  );
} catch {
  console.warn("Warning: git not available, keeping existing build number.");
  process.exit(0);
}

const buildNumber = commitCount + 1;
fs.writeFileSync(buildFile, JSON.stringify({ build: buildNumber }, null, 2) + "\n", "utf-8");
console.log(`Build number updated: ${buildNumber} (${commitCount} commits + 1)`);
