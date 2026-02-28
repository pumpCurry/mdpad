/**
 * ビルド番号の自動算出・更新スクリプト。
 *
 * 【動作概要】
 * - master ブランチのコミット数を基準にビルド番号を算出する。
 * - feature ブランチや worktree で作業中の場合は、master のコミット数 +
 *   ブランチ固有コミット数 + 1（将来のマージコミット分）を使用し、
 *   バージョン番号が master より逆進しないことを保証する。
 * - build-number.json と package.json の version フィールドを同時に更新する。
 *
 * 【バージョン形式】
 * - build-number.json: { "build": 63 }
 * - package.json: "version": "1.1.00063"
 * - アプリ表示: v1.1.00063
 * - インストーラ: mdpad-1.1.00063-setup.exe
 *
 * @file update-build-number.js
 * @version 1.1.00063
 * @revision 2
 * @lastModified 2026-03-01 22:00:00 (JST)
 *
 * Usage: node scripts/update-build-number.js
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const buildFile = path.join(__dirname, "..", "build-number.json");
const packageFile = path.join(__dirname, "..", "package.json");

/**
 * Git コマンドを安全に実行し、結果を整数で返す。
 *
 * @param {string} cmd - 実行する git コマンド
 * @returns {number|null} コミット数（失敗時は null）
 */
function gitCount(cmd) {
  try {
    return parseInt(execSync(cmd, { encoding: "utf-8" }).trim(), 10);
  } catch {
    return null;
  }
}

/**
 * 現在のブランチ名を取得する。
 *
 * @returns {string|null} ブランチ名（detached HEAD 等の場合は null）
 */
function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

// --- メイン処理 ---

const currentBranch = getCurrentBranch();
if (!currentBranch) {
  console.warn("Warning: git not available, keeping existing build number.");
  process.exit(0);
}

let commitCount;

if (currentBranch === "master" || currentBranch === "main") {
  // master/main ブランチ上: HEAD のコミット数をそのまま使用
  commitCount = gitCount("git rev-list --count HEAD");
  if (commitCount === null) {
    console.warn("Warning: could not count commits, keeping existing build number.");
    process.exit(0);
  }
  console.log(`On ${currentBranch}: ${commitCount} commits`);
} else {
  // feature ブランチ / worktree: master を基準にする
  // master のコミット数を取得
  const masterCount = gitCount("git rev-list --count master") ||
                      gitCount("git rev-list --count main");
  if (masterCount === null) {
    // master/main が参照できない場合は HEAD のコミット数にフォールバック
    commitCount = gitCount("git rev-list --count HEAD");
    console.warn("Warning: master/main branch not reachable, using HEAD count.");
  } else {
    // ブランチ固有のコミット数（master に無いコミット）
    const branchOnly = gitCount("git rev-list --count master..HEAD") || 0;
    // master のコミット数 + ブランチ固有 + 1（将来のマージコミット分）
    commitCount = masterCount + branchOnly + 1;
    console.log(`On branch '${currentBranch}': master=${masterCount}, branch-only=${branchOnly}, +1(merge)`);
  }
  if (commitCount === null) {
    console.warn("Warning: could not count commits, keeping existing build number.");
    process.exit(0);
  }
}

const buildNumber = commitCount + 1;

// --- build-number.json を更新 ---
fs.writeFileSync(buildFile, JSON.stringify({ build: buildNumber }, null, 2) + "\n", "utf-8");

// --- package.json の version フィールドを更新 ---
// 形式: {major}.{minor}.{buildNumber(5桁ゼロ埋め)}（例: 1.1.00063）
// major.minor は既存の package.json から取得する
const pkg = JSON.parse(fs.readFileSync(packageFile, "utf-8"));
const versionParts = pkg.version.split(".");
const major = versionParts[0] || "1";
const minor = versionParts[1] || "1";
const displayVersion = `${major}.${minor}.${String(buildNumber).padStart(5, "0")}`;
pkg.version = displayVersion;
fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

// --- 環境変数 MDPAD_DISPLAY_VERSION を設定 ---
// electron-builder.yml の artifactName で ${env.MDPAD_DISPLAY_VERSION} として参照される
process.env.MDPAD_DISPLAY_VERSION = displayVersion;

console.log(`Build number updated: ${buildNumber} (${commitCount} commits + 1)`);
console.log(`Package version: ${displayVersion}`);
console.log(`MDPAD_DISPLAY_VERSION=${displayVersion}`);
