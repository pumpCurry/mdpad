/**
 * view-state.js
 *
 * メインプロセス側のビュー状態管理モジュール。
 * レンダラー側の localStorage に保存されるビュー設定（書式バーモードなど）を
 * メインプロセスでも保持し、メニューの checked 状態との同期を実現する。
 *
 * 【動作フロー】
 * - initViewState() で mdpad-config.json からビュー設定を読み込む
 * - レンダラーから IPC 経由で設定変更が通知されると、メモリと mdpad-config.json を更新
 * - createMenu() がメニュー構築時に getFormatBarMode() を参照して checked を正しく設定
 *
 * 【永続化方式】
 * - file-watch-settings.js と同じく mdpad-config.json 内に保存
 * - キー: "formatBarMode"
 *
 * @file view-state.js
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 1
 * @lastModified 2026-03-05 12:00:00 (JST)
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * 書式バーの表示モード。
 * "topbar" = 上部表示、"sidebar" = 右側表示、"hidden" = 非表示。
 * デフォルトは "hidden"（レンダラー側の initFormatToolbar() のデフォルトと一致）。
 * @type {string}
 */
let formatBarMode = "hidden";

/**
 * ビュー状態を初期化する。
 * mdpad-config.json から書式バーモードを読み込む。
 * app.whenReady() 後に1回だけ呼び出すこと。
 *
 * @function initViewState
 */
function initViewState() {
  const config = loadConfig();
  if (
    typeof config.formatBarMode === "string" &&
    ["topbar", "sidebar", "hidden"].includes(config.formatBarMode)
  ) {
    formatBarMode = config.formatBarMode;
  }
}

/**
 * 現在の書式バーモードを返す。
 *
 * @function getFormatBarMode
 * @returns {string} "topbar" | "sidebar" | "hidden"
 */
function getFormatBarMode() {
  return formatBarMode;
}

/**
 * 書式バーモードを設定し、mdpad-config.json に保存する。
 * メニュー再構築は呼び出し元で行う。
 *
 * @function setFormatBarMode
 * @param {string} mode - "topbar" | "sidebar" | "hidden"
 */
function setFormatBarMode(mode) {
  if (["topbar", "sidebar", "hidden"].includes(mode)) {
    formatBarMode = mode;
    saveConfigKey("formatBarMode", formatBarMode);
  }
}

/**
 * mdpad-config.json を読み込む。
 * ファイルが存在しないか読み込みに失敗した場合は空オブジェクトを返す。
 *
 * @function loadConfig
 * @returns {Object} 設定オブジェクト
 */
function loadConfig() {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * mdpad-config.json の指定キーの値を更新して保存する。
 * 既存のキーは保持し、指定キーのみ上書きする。
 *
 * @function saveConfigKey
 * @param {string} key - 設定キー名
 * @param {*} value - 設定値
 */
function saveConfigKey(key, value) {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // 空の設定ファイルとして扱う
  }
  config[key] = value;
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // 書き込みエラーは無視（権限問題など）
  }
}

module.exports = {
  initViewState,
  getFormatBarMode,
  setFormatBarMode,
};
