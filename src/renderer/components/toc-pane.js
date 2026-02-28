/**
 * toc-pane.js
 *
 * TOC（Table of Contents / 目次）サイドバーペイン。
 * エディタの内容から Markdown 見出しを抽出し、
 * クリックで該当行にジャンプするナビゲーション機能を提供する。
 *
 * 【動作フロー】
 * - エディタ内容変更時に見出しを再パース（300ms debounce）
 * - コードブロック内の `#` は見出しとして認識しない
 * - 見出しレベル (H1-H6) に応じたインデント付きリストを生成
 * - 各項目クリックで goToLine() を呼び出し
 *
 * 【レイアウト】
 * - #pane-container の左側にサイドバーとして配置
 * - 幅 200px（デフォルト）、リサイズハンドル付き
 * - 表示/非表示は View メニューまたはキーボードショートカットで切り替え
 *
 * @file toc-pane.js
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 1
 * @lastModified 2026-03-01 00:00:00 (JST)
 */

import { goToLine, getEditor } from "./editor-pane.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

/** localStorage キー */
const STORAGE_KEY = "mdpad:tocVisible";
const STORAGE_KEY_WIDTH = "mdpad:tocWidth";

/** デフォルトの TOC ペイン幅 (px) */
const DEFAULT_WIDTH = 200;
const MIN_WIDTH = 120;
const MAX_WIDTH = 500;

/** DOM 要素の参照 */
let tocPaneEl = null;
let tocContentEl = null;
let tocHeaderEl = null;
let resizeHandleEl = null;

/** 表示状態 */
let tocVisible = localStorage.getItem(STORAGE_KEY) === "true";

/** 見出しリストのキャッシュ（再描画の抑制用） */
let lastHeadingsJson = "";

/** debounce タイマー */
let updateTimer = null;

/**
 * Markdown テキストから見出しを抽出する。
 * コードブロック（``` ~ ```）内の行は除外する。
 *
 * @param {string} content - Markdown テキスト
 * @returns {Array<{level: number, text: string, line: number}>} 見出し配列
 */
function parseHeadings(content) {
  const lines = content.split("\n");
  const headings = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // コードブロックの開始/終了を追跡
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // コードブロック内はスキップ
    if (inCodeBlock) continue;

    // 見出しパターンのマッチ（# ～ ###### の1-6レベル）
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/\s*#+\s*$/, "").trim(), // 末尾の # を除去
        line: i + 1, // 1-indexed
      });
    }
  }

  return headings;
}

/**
 * TOC ペインを初期化する。
 * DOM 要素の生成、イベントリスナーの設定を行う。
 *
 * 【注意】
 * - この関数は init() から1回だけ呼ばれる
 * - #pane-container の前に TOC ペインとリサイズハンドルを挿入する
 */
export function initTocPane() {
  const paneContainer = document.getElementById("pane-container");
  if (!paneContainer) return;

  // TOC ペイン要素を生成
  tocPaneEl = document.createElement("div");
  tocPaneEl.id = "toc-pane";
  tocPaneEl.className = "toc-pane";
  tocPaneEl.style.display = tocVisible ? "flex" : "none";

  // 保存された幅を復元
  const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY_WIDTH), 10);
  if (savedWidth && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
    tocPaneEl.style.width = savedWidth + "px";
  }

  // ヘッダー
  tocHeaderEl = document.createElement("div");
  tocHeaderEl.className = "toc-header";
  tocHeaderEl.innerHTML = `
    <span class="toc-title">${t("toc.title")}</span>
    <button class="toc-close" title="${t("toc.close")}">&times;</button>
  `;
  tocPaneEl.appendChild(tocHeaderEl);

  // 閉じるボタンのイベント
  tocHeaderEl.querySelector(".toc-close").addEventListener("click", () => {
    toggleTocPane();
  });

  // コンテンツエリア
  tocContentEl = document.createElement("div");
  tocContentEl.className = "toc-content";
  tocContentEl.innerHTML = `<div class="toc-empty">${t("toc.empty")}</div>`;
  tocPaneEl.appendChild(tocContentEl);

  // リサイズハンドル（TOC ペインの右端）
  resizeHandleEl = document.createElement("div");
  resizeHandleEl.className = "toc-resize-handle";
  setupResizeHandle(resizeHandleEl);

  // DOM に挿入: pane-container の前に配置
  paneContainer.parentNode.insertBefore(tocPaneEl, paneContainer);
  paneContainer.parentNode.insertBefore(resizeHandleEl, paneContainer);

  // リサイズハンドルの表示制御
  resizeHandleEl.style.display = tocVisible ? "block" : "none";

  // ロケール変更時に再描画
  onLocaleChange(() => {
    if (tocHeaderEl) {
      tocHeaderEl.querySelector(".toc-title").textContent = t("toc.title");
      tocHeaderEl.querySelector(".toc-close").title = t("toc.close");
    }
    // 空メッセージも更新
    const emptyEl = tocContentEl?.querySelector(".toc-empty");
    if (emptyEl) emptyEl.textContent = t("toc.empty");
  });
}

/**
 * TOC ペインの表示/非表示を切り替える。
 * 状態は localStorage に保存される。
 *
 * @returns {boolean} 切り替え後の表示状態
 */
export function toggleTocPane() {
  tocVisible = !tocVisible;
  localStorage.setItem(STORAGE_KEY, String(tocVisible));

  if (tocPaneEl) {
    tocPaneEl.style.display = tocVisible ? "flex" : "none";
  }
  if (resizeHandleEl) {
    resizeHandleEl.style.display = tocVisible ? "block" : "none";
  }

  return tocVisible;
}

/**
 * TOC ペインが表示中かどうかを返す。
 *
 * @returns {boolean} 表示中なら true
 */
export function isTocVisible() {
  return tocVisible;
}

/**
 * エディタの内容に基づいて TOC を更新する。
 * 300ms の debounce で頻繁な更新を抑制する。
 *
 * @param {string} content - エディタの現在のテキスト内容
 */
export function updateToc(content) {
  if (!tocVisible) return; // 非表示時はスキップ

  // debounce
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTocImmediate(content);
  }, 300);
}

/**
 * TOC を即座に更新する（debounce なし）。
 * 見出しをパースし、DOM を再構築する。
 *
 * @param {string} content - エディタの現在のテキスト内容
 */
function updateTocImmediate(content) {
  if (!tocContentEl) return;

  const headings = parseHeadings(content);
  const newJson = JSON.stringify(headings);

  // 変更がなければ再描画をスキップ
  if (newJson === lastHeadingsJson) return;
  lastHeadingsJson = newJson;

  // コンテンツをクリア
  tocContentEl.innerHTML = "";

  if (headings.length === 0) {
    tocContentEl.innerHTML = `<div class="toc-empty">${t("toc.empty")}</div>`;
    return;
  }

  // 見出しリストを生成
  headings.forEach((heading) => {
    const item = document.createElement("div");
    item.className = "toc-item";
    item.dataset.level = String(heading.level);
    item.dataset.line = String(heading.line);
    item.textContent = heading.text;
    item.title = `${heading.text} (L${heading.line})`;

    // クリックで該当行にジャンプ
    item.addEventListener("click", () => {
      goToLine(heading.line);
      const editor = getEditor();
      if (editor) editor.focus();

      // アクティブ状態を更新
      tocContentEl.querySelectorAll(".toc-item.active").forEach((el) => {
        el.classList.remove("active");
      });
      item.classList.add("active");
    });

    tocContentEl.appendChild(item);
  });
}

/**
 * TOC ペインのリサイズハンドルを設定する。
 * ドラッグでペイン幅を変更し、localStorage に保存する。
 *
 * @param {HTMLElement} handle - リサイズハンドル要素
 */
function setupResizeHandle(handle) {
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("active");

    startX = e.clientX;
    startWidth = tocPaneEl.offsetWidth;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + dx));
      tocPaneEl.style.width = newWidth + "px";
    };

    const onUp = (e) => {
      handle.classList.remove("active");
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);

      // 幅を保存
      localStorage.setItem(STORAGE_KEY_WIDTH, String(tocPaneEl.offsetWidth));
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}
