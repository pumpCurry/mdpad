/**
 * NSISインストーラをビルドするスクリプト。
 *
 * package.json の version (例: "1.1.0") にビルド番号を付加した
 * 正式バージョン (例: "1.1.00056") で electron-builder を実行する。
 * ZIPポータブル版 (create-zip.js) と同じバージョン命名規則を適用。
 *
 * electron-builder --win dir で既にパッケージ済みの win-unpacked がある場合、
 * --prepackaged フラグで再パッケージをスキップし、高速にインストーラだけを生成する。
 * win-unpacked が存在しない場合はフルビルドを実行する。
 *
 * @file build-installer.js
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 2
 * @lastModified 2026-02-28 20:45:00 (JST)
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const rootDir = path.join(__dirname, "..");
const pkg = require(path.join(rootDir, "package.json"));

// electron-builder.yml からビルド出力ディレクトリを取得
let ebOutput = "build";
try {
  const ymlPath = path.join(rootDir, "electron-builder.yml");
  const ymlContent = fs.readFileSync(ymlPath, "utf-8");
  const match = ymlContent.match(/^\s*output:\s*(.+)/m);
  if (match) ebOutput = match[1].trim();
} catch {}
const unpackedDir = path.join(rootDir, ebOutput, "win-unpacked");

// ビルド番号を読み込む（prebuild:renderer で更新済み前提）
let buildNumber = 1;
try {
  const buildData = JSON.parse(
    fs.readFileSync(path.join(rootDir, "build-number.json"), "utf-8")
  );
  buildNumber = buildData.build || 1;
} catch {
  console.warn("Warning: build-number.json not found, using build=1");
}

// バージョン文字列を構築: major.minor.paddedBuild (例: 1.1.00056)
const [major, minor] = pkg.version.split(".");
const paddedBuild = String(buildNumber).padStart(5, "0");
const fullVersion = `${major}.${minor}.${paddedBuild}`;

console.log(`Building NSIS installer with version: ${fullVersion}`);
console.log(`  package.json version: ${pkg.version}`);
console.log(`  Build number: ${buildNumber}`);

// win-unpacked が既に存在する場合は --prepackaged で再パッケージをスキップ
// Dropboxなどのファイル同期サービスがファイルをロックする問題を回避
const usePrepackaged = fs.existsSync(path.join(unpackedDir, "mdpad.exe"));

let cmd;
if (usePrepackaged) {
  console.log(`  Using prepackaged dir: ${unpackedDir}`);
  cmd = `npx electron-builder --win nsis --prepackaged "${unpackedDir}" -c.extraMetadata.version=${fullVersion}`;
} else {
  console.log(`  No prepackaged dir found, running full build`);
  cmd = `npx electron-builder --win nsis -c.extraMetadata.version=${fullVersion}`;
}

// electron-builder を実行してNSISインストーラを生成
try {
  execSync(cmd, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  console.log(`\nInstaller built successfully: mdpad-${fullVersion}-setup.exe`);
} catch (err) {
  console.error("Installer build failed:", err.message);
  process.exit(1);
}
