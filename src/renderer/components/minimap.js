/**
 * minimap.js
 *
 * @replit/codemirror-minimap を利用したミニマップ表示モジュール。
 * Compartment ベースの ON/OFF 切り替えと表示モード (blocks/characters) の
 * 切り替えをサポートし、設定は localStorage に永続化する。
 *
 * @file minimap.js
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 1
 * @lastModified 2026-03-01 00:00:00 (JST)
 */

import { showMinimap } from "@replit/codemirror-minimap";
import { Compartment } from "@codemirror/state";

/** localStorage キー */
const STORAGE_KEY_ENABLED = "mdpad:minimapEnabled";
const STORAGE_KEY_DISPLAY = "mdpad:minimapDisplay";

/** Compartment（エディタ拡張の動的切り替え用） */
const minimapCompartment = new Compartment();

/** ミニマップの有効/無効状態（デフォルト: OFF） */
let minimapEnabled = localStorage.getItem(STORAGE_KEY_ENABLED) === "true";

/** 表示モード: "blocks" or "characters"（デフォルト: blocks） */
let displayMode = localStorage.getItem(STORAGE_KEY_DISPLAY) || "blocks";

/**
 * ミニマップ用 CodeMirror Facet 拡張を生成する。
 * エディタの state に応じて showMinimap Facet を計算する。
 *
 * @returns {import("@codemirror/state").Extension} ミニマップ拡張
 */
function createMinimapExt() {
  return showMinimap.compute(["doc"], (state) => ({
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-minimap-container";
      dom.style.cssText = "cursor: pointer;";
      return { dom };
    },
    displayText: displayMode,
    showOverlay: "always",
  }));
}

/**
 * Compartment ラップされたミニマップ拡張を返す。
 * createEditor() の extensions 配列に含めて使用する。
 *
 * @returns {import("@codemirror/state").Extension} Compartment 付きミニマップ拡張
 */
export function getMinimapExtension() {
  return minimapCompartment.of(minimapEnabled ? createMinimapExt() : []);
}

/**
 * ミニマップの ON/OFF を切り替える。
 * localStorage に状態を保存し、エディタの Compartment を再構成する。
 *
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 * @returns {boolean} 切り替え後のミニマップ有効状態
 */
export function toggleMinimap(view) {
  minimapEnabled = !minimapEnabled;
  localStorage.setItem(STORAGE_KEY_ENABLED, String(minimapEnabled));
  view.dispatch({
    effects: minimapCompartment.reconfigure(
      minimapEnabled ? createMinimapExt() : []
    ),
  });
  return minimapEnabled;
}

/**
 * ミニマップの表示モードを切り替える (blocks ↔ characters)。
 * localStorage に状態を保存し、エディタの Compartment を再構成する。
 *
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 * @returns {string} 切り替え後の表示モード ("blocks" or "characters")
 */
export function toggleMinimapDisplayMode(view) {
  displayMode = displayMode === "blocks" ? "characters" : "blocks";
  localStorage.setItem(STORAGE_KEY_DISPLAY, displayMode);
  if (minimapEnabled) {
    view.dispatch({
      effects: minimapCompartment.reconfigure(createMinimapExt()),
    });
  }
  return displayMode;
}

/**
 * ミニマップが有効かどうかを返す。
 *
 * @returns {boolean} ミニマップの有効状態
 */
export function isMinimapEnabled() {
  return minimapEnabled;
}

/**
 * 現在のミニマップ表示モードを返す。
 *
 * @returns {string} "blocks" or "characters"
 */
export function getMinimapDisplayMode() {
  return displayMode;
}
