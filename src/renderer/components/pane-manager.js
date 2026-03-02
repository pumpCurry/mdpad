/**
 * @fileoverview ペインマネージャー
 * @description
 * エディタ・プレビュー・目次(TOC)・差分の4ペインの表示/非表示と
 * リサイズハンドルを統合管理する。
 *
 * 【動作フロー】
 * - PANE_ORDER に定義された正規順序（editor → preview → toc → diff）に基づいて
 *   表示中のペインを列挙し、隣接するペイン間にリサイズハンドルを動的に配置する。
 * - applyLayout() が DOM 再配置とフレックス値の設定を一括で行う。
 * - TOC ペインのみ固定幅（デフォルト200px）、他ペインは flex: 1 1 0 で均等分割。
 * - リサイズハンドルは最大3本（handle1〜handle3）を動的バインドで使い回す。
 *
 * 【注意】
 * - setupResizeHandle() は初期化時に1回だけイベントを登録し、
 *   左右ペインの参照は handleBindings 配列で動的に解決する。
 * - TOC の表示状態は localStorage("mdpad:tocVisible") から復元される。
 *
 * @file pane-manager.js
 * @version 1.1.00064
 * @since 0.1.10020
 * @revision 2
 * @lastModified 2026-03-02 01:00:00 (JST)
 */

import { refreshLayout as refreshEditor } from "./editor-pane.js";

/**
 * ペインの正規表示順序。
 * applyLayout() はこの順序で表示中ペインを列挙し、DOM を再配置する。
 * @type {string[]}
 */
const PANE_ORDER = ["editor", "preview", "toc", "diff"];

/**
 * TOC ペインのデフォルト幅 (px)。
 * localStorage に保存値がない場合に使用される。
 * @type {number}
 */
const TOC_DEFAULT_WIDTH = 200;

/**
 * localStorage キー: TOC ペインの幅
 * @type {string}
 */
const TOC_WIDTH_KEY = "mdpad:tocWidth";

/**
 * 各ペインの表示状態。
 * true = 表示中、false = 非表示。
 * @type {{editor: boolean, preview: boolean, toc: boolean, diff: boolean}}
 */
let paneState = {
  editor: true,
  preview: false,
  toc: false,
  diff: false,
};

/**
 * DOM 要素の参照キャッシュ。
 * initPaneManager() で初期化される。
 * @type {Object}
 */
let elements = {};

/**
 * ペイン状態変更時のコールバック関数。
 * togglePane() / setPaneState() の後に呼ばれる。
 * @type {Function|null}
 */
let onPaneChangeCallback = null;

/**
 * リサイズハンドルの動的バインド情報。
 * 各ハンドルがどのペイン間に配置されているかを保持する。
 * applyLayout() で毎回更新される。
 * @type {Array<{left: string|null, right: string|null}>}
 */
const handleBindings = [
  { left: null, right: null },
  { left: null, right: null },
  { left: null, right: null },
];

/**
 * ペイン状態変更時のコールバックを登録する。
 *
 * @param {Function} callback - コールバック関数。引数に paneState のコピーが渡される。
 */
export function onPaneChange(callback) {
  onPaneChangeCallback = callback;
}

/**
 * ペインマネージャーを初期化する。
 *
 * 【動作フロー】
 * - DOM 要素の参照を取得しキャッシュ
 * - 3本のリサイズハンドルにイベントリスナーを登録
 * - localStorage から TOC の表示状態を復元
 * - applyLayout() で初期レイアウトを適用
 *
 * @function initPaneManager
 */
export function initPaneManager() {
  elements = {
    editor: document.getElementById("editor-pane"),
    preview: document.getElementById("preview-pane"),
    toc: document.getElementById("toc-pane"),
    diff: document.getElementById("diff-pane"),
    handle1: document.getElementById("resize-handle-1"),
    handle2: document.getElementById("resize-handle-2"),
    handle3: document.getElementById("resize-handle-3"),
    container: document.getElementById("pane-container"),
  };

  // 3本のリサイズハンドルにイベントリスナーを登録
  // 左右ペインのバインドは applyLayout() で動的に設定される
  const handles = [elements.handle1, elements.handle2, elements.handle3];
  handles.forEach((handle, index) => {
    if (handle) {
      setupResizeHandle(handle, index);
    }
  });

  // localStorage から TOC の表示状態を復元
  if (localStorage.getItem("mdpad:tocVisible") === "true") {
    paneState.toc = true;
  }

  applyLayout();
}

/**
 * 指定ペインの表示/非表示をトグルする。
 *
 * 【注意】
 * - 全ペインが非表示になる操作は拒否される（最低1ペインは表示必須）
 * - トグル後に applyLayout() と onPaneChangeCallback が呼ばれる
 *
 * @function togglePane
 * @param {string} name - ペイン名（"editor", "preview", "toc", "diff"）
 */
export function togglePane(name) {
  if (!paneState.hasOwnProperty(name)) return;

  // 全ペイン非表示を防止
  const newState = !paneState[name];
  const otherPanesVisible = Object.entries(paneState)
    .filter(([k]) => k !== name)
    .some(([, v]) => v);

  if (!newState && !otherPanesVisible) return; // 最低1ペインは表示必須

  paneState[name] = newState;
  applyLayout();
  if (onPaneChangeCallback) onPaneChangeCallback({ ...paneState });
}

/**
 * ペイン状態を一括設定する。
 *
 * @function setPaneState
 * @param {Object} state - 設定するペイン状態（部分指定可能）
 */
export function setPaneState(state) {
  paneState = { ...paneState, ...state };
  applyLayout();
  if (onPaneChangeCallback) onPaneChangeCallback({ ...paneState });
}

/**
 * 現在のペイン状態のコピーを返す。
 *
 * @function getPaneState
 * @returns {{editor: boolean, preview: boolean, toc: boolean, diff: boolean}} ペイン状態のコピー
 */
export function getPaneState() {
  return { ...paneState };
}

/**
 * ペイン状態に基づいて DOM レイアウトを適用する。
 *
 * 【動作フロー】
 * 1. PANE_ORDER に従い、表示中のペインを列挙
 * 2. 各ペインの display（flex/none）と flex 値を設定
 *    - TOC ペイン: flex: 0 0 {savedWidth}px（固定幅）
 *    - 他ペイン: flex: 1 1 0（均等分割）
 * 3. 表示中の隣接ペイン間にリサイズハンドルを動的配置
 * 4. DOM 要素を正しい順序で再配置（appendChild）
 * 5. CodeMirror のレイアウトを再測定
 *
 * @function applyLayout
 */
function applyLayout() {
  // --- 1. 表示中ペインを PANE_ORDER 順に列挙 ---
  const visiblePanes = PANE_ORDER.filter((name) => paneState[name]);

  // --- 2. 各ペインの display と flex を設定 ---
  for (const name of PANE_ORDER) {
    const el = elements[name];
    if (!el) continue;

    if (paneState[name]) {
      el.style.display = "flex";
      if (name === "toc") {
        // TOC は固定幅（localStorage から復元、またはデフォルト200px）
        const savedWidth = parseInt(localStorage.getItem(TOC_WIDTH_KEY), 10);
        const tocWidth =
          savedWidth && savedWidth >= 120 && savedWidth <= 500
            ? savedWidth
            : TOC_DEFAULT_WIDTH;
        el.style.flex = `0 0 ${tocWidth}px`;
      } else {
        // 他のペインは均等分割
        el.style.flex = "1 1 0";
      }
    } else {
      el.style.display = "none";
      el.style.flex = "";
    }
  }

  // --- 3. リサイズハンドルの動的バインド ---
  const handleKeys = ["handle1", "handle2", "handle3"];

  // まず全ハンドルを非表示にリセット
  for (let i = 0; i < handleKeys.length; i++) {
    const hEl = elements[handleKeys[i]];
    if (hEl) hEl.style.display = "none";
    handleBindings[i].left = null;
    handleBindings[i].right = null;
  }

  // 表示中ペインの隣接ペア間にハンドルを配置
  for (let i = 0; i < visiblePanes.length - 1 && i < handleKeys.length; i++) {
    const hEl = elements[handleKeys[i]];
    if (hEl) {
      hEl.style.display = "block";
      handleBindings[i].left = visiblePanes[i];
      handleBindings[i].right = visiblePanes[i + 1];
    }
  }

  // --- 4. DOM 再配置 ---
  // 表示中のペインとハンドルを正しい順序で配置
  const container = elements.container;
  let handleIdx = 0;
  for (let i = 0; i < visiblePanes.length; i++) {
    container.appendChild(elements[visiblePanes[i]]);
    // ペイン間にハンドルを挿入（最後のペインの後には不要）
    if (i < visiblePanes.length - 1 && handleIdx < handleKeys.length) {
      container.appendChild(elements[handleKeys[handleIdx]]);
      handleIdx++;
    }
  }

  // 非表示ペインと残りのハンドルは末尾に配置（DOM から除外せず display:none のまま）
  for (const name of PANE_ORDER) {
    if (!paneState[name] && elements[name]) {
      container.appendChild(elements[name]);
    }
  }
  for (let i = handleIdx; i < handleKeys.length; i++) {
    if (elements[handleKeys[i]]) {
      container.appendChild(elements[handleKeys[i]]);
    }
  }

  // --- 5. CodeMirror レイアウト再測定 ---
  requestAnimationFrame(() => {
    refreshEditor();
  });
}

/**
 * リサイズハンドルにドラッグイベントを登録する。
 *
 * 【動作フロー】
 * - pointerdown で左右ペインの現在幅を記録
 * - pointermove でドラッグ量に応じて両ペインの flex 値を変更
 * - pointerup で確定し、TOC ペインの場合は localStorage に幅を保存
 *
 * 【注意】
 * - 左右ペインの参照は handleBindings[index] から動的に取得される。
 *   applyLayout() が呼ばれるたびにバインドが更新される可能性がある。
 * - setPointerCapture() でハンドル外へのマウス移動にも追従する。
 *
 * @function setupResizeHandle
 * @param {HTMLElement} handle - リサイズハンドル要素
 * @param {number} index - handleBindings 配列のインデックス（0, 1, 2）
 */
function setupResizeHandle(handle, index) {
  handle.addEventListener("pointerdown", (e) => {
    const binding = handleBindings[index];
    // バインドが未設定（表示中でないハンドル）の場合は何もしない
    if (!binding.left || !binding.right) return;

    const leftEl = elements[binding.left];
    const rightEl = elements[binding.right];
    if (!leftEl || !rightEl) return;

    e.preventDefault();
    handle.classList.add("active");
    handle.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startLeftWidth = leftEl.offsetWidth;
    const startRightWidth = rightEl.offsetWidth;

    /**
     * ドラッグ中のマウス移動ハンドラ。
     * 左右ペインの幅を最小100pxを維持しながら調整する。
     *
     * @param {PointerEvent} moveEvent - pointermove イベント
     */
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const newLeftWidth = Math.max(100, startLeftWidth + dx);
      const newRightWidth = Math.max(100, startRightWidth - dx);

      leftEl.style.flex = `0 0 ${newLeftWidth}px`;
      rightEl.style.flex = `0 0 ${newRightWidth}px`;

      refreshEditor();
    };

    /**
     * ドラッグ終了ハンドラ。
     * ポインターキャプチャを解放し、TOC ペインの場合は localStorage に幅を保存する。
     *
     * @param {PointerEvent} upEvent - pointerup イベント
     */
    const onUp = (upEvent) => {
      handle.classList.remove("active");
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);

      // TOC ペインの幅を localStorage に保存
      // 左右どちらかが TOC の場合に保存する
      if (binding.left === "toc" && leftEl) {
        localStorage.setItem(TOC_WIDTH_KEY, String(leftEl.offsetWidth));
      }
      if (binding.right === "toc" && rightEl) {
        localStorage.setItem(TOC_WIDTH_KEY, String(rightEl.offsetWidth));
      }

      refreshEditor();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}
