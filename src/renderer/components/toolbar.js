/**
 * @fileoverview ツールバー
 * @description
 * ペイン切替ボタン（編集・プレビュー・目次・差分）と
 * プリセットレイアウトボタン（編集+プレビュー・全表示）を管理する。
 *
 * 【動作フロー】
 * - initToolbar() でボタンコンテナを生成し、renderToolbar() でボタンを描画
 * - 各ボタンクリックで pane-manager の togglePane() / setPaneState() を呼び出し
 * - updateButtonStates() で paneState に基づいてボタンの active 状態を同期
 * - ロケール変更時に renderToolbar() を再実行して翻訳を反映
 *
 * 【ボタン配置】
 * [編集] [プレビュー] [目次] [差分] | [編集+プレビュー] [全表示]
 *
 * @file toolbar.js
 * @version 1.1.00064
 * @since 0.1.10020
 * @revision 2
 * @lastModified 2026-03-02 01:00:00 (JST)
 */

import { getPaneState, togglePane, setPaneState } from "./pane-manager.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

/** ツールバーのルート要素 */
let toolbarEl = null;

/** ボタン専用コンテナ（グローバル検索バーと分離するため） */
let buttonsContainer = null;

/**
 * 個別ペイントグルボタンの参照。
 * updateButtonStates() で active クラスの設定に使用する。
 * @type {{editor: HTMLElement|null, preview: HTMLElement|null, toc: HTMLElement|null, diff: HTMLElement|null}}
 */
let buttons = {};

/**
 * ツールバーを初期化する。
 * ボタンコンテナを生成し、renderToolbar() で初回描画を行う。
 *
 * 【注意】
 * - グローバル検索バーはツールバーのスペーサー右側に配置されるため、
 *   ボタンコンテナ（#toolbar-buttons）を別要素として分離し、
 *   renderToolbar() での再描画時にグローバル検索バーが破壊されないようにする。
 *
 * @function initToolbar
 */
export function initToolbar() {
  toolbarEl = document.getElementById("toolbar");

  // ボタン専用コンテナを生成（グローバル検索バーの保護）
  buttonsContainer = document.createElement("div");
  buttonsContainer.id = "toolbar-buttons";
  toolbarEl.appendChild(buttonsContainer);

  // スペーサー（グローバル検索バーを右側に配置するため）
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  toolbarEl.appendChild(spacer);

  renderToolbar();

  // ロケール変更時にボタンラベルを再描画
  onLocaleChange(() => renderToolbar());
}

/**
 * ツールバーのボタンを描画する。
 * ロケール変更時にも呼ばれるため、innerHTML で全置換する。
 *
 * 【ボタン構成】
 * - 個別トグル: 編集, プレビュー, 目次, 差分
 * - セパレータ
 * - プリセット: 編集+プレビュー, 全表示（4ペイン全表示）
 *
 * @function renderToolbar
 */
function renderToolbar() {
  buttonsContainer.innerHTML = `
    <button id="btn-editor" title="${t("toolbar.tipEditor")}">${t("toolbar.edit")}</button>
    <button id="btn-preview" title="${t("toolbar.tipPreview")}">${t("toolbar.preview")}</button>
    <button id="btn-toc" title="${t("toolbar.tipToc")}">${t("toolbar.toc")}</button>
    <button id="btn-diff" title="${t("toolbar.tipDiff")}">${t("toolbar.diff")}</button>
    <div class="separator"></div>
    <button id="btn-edit-preview" title="${t("toolbar.tipEditPreview")}">${t("toolbar.editPreview")}</button>
    <button id="btn-all" title="${t("toolbar.tipAll")}">${t("toolbar.all")}</button>
  `;

  // 個別トグルボタンの参照を保持
  buttons = {
    editor: buttonsContainer.querySelector("#btn-editor"),
    preview: buttonsContainer.querySelector("#btn-preview"),
    toc: buttonsContainer.querySelector("#btn-toc"),
    diff: buttonsContainer.querySelector("#btn-diff"),
  };

  // 個別ペイントグルボタンのクリックハンドラ
  buttons.editor.addEventListener("click", () => {
    togglePane("editor");
    updateButtonStates();
  });
  buttons.preview.addEventListener("click", () => {
    togglePane("preview");
    updateButtonStates();
  });
  buttons.toc.addEventListener("click", () => {
    togglePane("toc");
    updateButtonStates();
  });
  buttons.diff.addEventListener("click", () => {
    togglePane("diff");
    updateButtonStates();
  });

  // プリセットレイアウトボタン
  // 編集+プレビュー: TOC と差分は非表示
  buttonsContainer.querySelector("#btn-edit-preview").addEventListener("click", () => {
    setPaneState({ editor: true, preview: true, toc: false, diff: false });
    updateButtonStates();
  });

  // 全表示: 4ペインすべて表示
  buttonsContainer.querySelector("#btn-all").addEventListener("click", () => {
    setPaneState({ editor: true, preview: true, toc: true, diff: true });
    updateButtonStates();
  });

  updateButtonStates();
}

/**
 * ペイン状態に基づいてツールバーボタンの active クラスを同期する。
 * paneState が変更されるたびに呼ばれる。
 *
 * @function updateButtonStates
 */
export function updateButtonStates() {
  const state = getPaneState();
  for (const [name, btn] of Object.entries(buttons)) {
    if (btn) btn.classList.toggle("active", state[name]);
  }
}
