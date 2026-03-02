/**
 * @fileoverview TOC（目次）ペイン
 * @description
 * エディタの内容から Markdown 見出しを抽出し、
 * クリックで該当行にジャンプするナビゲーション機能を提供する。
 * #pane-container 内の正式なペイン（editor → preview → toc → diff の順）として動作する。
 *
 * 【動作フロー】
 * - エディタ内容変更時に見出しを再パース（300ms debounce）
 * - コードブロック内の `#` は見出しとして認識しない
 * - 見出しレベル (H1-H6) に応じたインデント付きリストを生成
 * - 各項目クリックで goToLine() を呼び出し
 * - カーソル位置に応じて「現在のセクション」をハイライト（cursor-active）
 * - エディタのビューポート範囲内の見出しをマーク（viewport-visible）
 * - アクティブ見出しが TOC の表示範囲外なら自動スクロール
 *
 * 【レイアウト】
 * - #pane-container 内の .pane として配置（preview と diff の間）
 * - デフォルト幅 200px（pane-manager.js が flex 値を制御）
 * - リサイズは pane-manager.js の共通リサイズハンドルが担当
 *
 * @file toc-pane.js
 * @version 1.1.00064
 * @since 0.1.10020
 * @revision 2
 * @lastModified 2026-03-02 01:00:00 (JST)
 */

import { goToLine, getEditor } from "./editor-pane.js";
import { togglePane } from "./pane-manager.js";
import { updateButtonStates } from "./toolbar.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

/** DOM 要素の参照 */
let tocPaneEl = null;
let tocContentEl = null;
let tocHeaderEl = null;

/** 見出しリストのキャッシュ（再描画の抑制用） */
let lastHeadingsJson = "";

/** debounce タイマー */
let updateTimer = null;

/** カーソル追随ハイライトのキャッシュ（前回値と同じならスキップ） */
let lastCursorLine = -1;

/** ビューポート追随のキャッシュ */
let lastTopLine = -1;
let lastBottomLine = -1;

/**
 * Markdown テキストから見出しを抽出する。
 * コードブロック（``` ~ ```）内の行は除外する。
 *
 * @function parseHeadings
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
 * HTML に静的配置された DOM 要素の参照取得、イベントリスナーの設定を行う。
 *
 * 【注意】
 * - この関数は init() から1回だけ呼ばれる
 * - DOM 要素は index.html に静的に配置されている（#pane-container 内）
 * - 表示/非表示は pane-manager.js の togglePane("toc") が制御する
 *
 * @function initTocPane
 */
export function initTocPane() {
  // HTML に静的配置された要素を参照
  tocPaneEl = document.getElementById("toc-pane");
  if (!tocPaneEl) return;

  tocHeaderEl = tocPaneEl.querySelector(".toc-header");
  tocContentEl = tocPaneEl.querySelector(".toc-content");

  // i18n テキスト設定
  const titleEl = tocHeaderEl.querySelector(".toc-title");
  const closeBtn = tocHeaderEl.querySelector(".toc-close");
  const emptyEl = tocContentEl.querySelector(".toc-empty");

  if (titleEl) titleEl.textContent = t("toc.title");
  if (closeBtn) closeBtn.title = t("toc.close");
  if (emptyEl) emptyEl.textContent = t("toc.empty");

  // 閉じるボタン → pane-manager に委譲
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      togglePane("toc");
      updateButtonStates();
    });
  }

  // ロケール変更時にテキストを再設定
  onLocaleChange(() => {
    if (titleEl) titleEl.textContent = t("toc.title");
    if (closeBtn) closeBtn.title = t("toc.close");
    // 空メッセージも更新（見出しがない場合のみ DOM に存在する）
    const currentEmptyEl = tocContentEl?.querySelector(".toc-empty");
    if (currentEmptyEl) currentEmptyEl.textContent = t("toc.empty");
  });
}

/**
 * エディタの内容に基づいて TOC を更新する。
 * 300ms の debounce で頻繁な更新を抑制する。
 *
 * 【注意】
 * - 非表示時もスキップしない（ペイン表示時に最新状態が必要なため）
 *
 * @function updateToc
 * @param {string} content - エディタの現在のテキスト内容
 */
export function updateToc(content) {
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
 * @function updateTocImmediate
 * @param {string} content - エディタの現在のテキスト内容
 */
function updateTocImmediate(content) {
  if (!tocContentEl) return;

  const headings = parseHeadings(content);
  const newJson = JSON.stringify(headings);

  // 変更がなければ再描画をスキップ
  if (newJson === lastHeadingsJson) return;
  lastHeadingsJson = newJson;

  // ハイライトキャッシュをリセット（見出し構造が変わったため）
  lastCursorLine = -1;
  lastTopLine = -1;
  lastBottomLine = -1;

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

      // アクティブ状態を更新（手動クリック）
      tocContentEl.querySelectorAll(".toc-item.active").forEach((el) => {
        el.classList.remove("active");
      });
      item.classList.add("active");
    });

    tocContentEl.appendChild(item);
  });
}

/**
 * カーソル位置に基づいて TOC のアクティブ見出しを更新する。
 * カーソルが属する見出しセクション（カーソル行以前の最後の見出し）を
 * cursor-active クラスでハイライトし、必要に応じて TOC を自動スクロールする。
 *
 * 【パフォーマンス最適化】
 * - 前回と同じカーソル行の場合は処理をスキップする
 *
 * @function updateTocHighlight
 * @param {number} cursorLine - エディタのカーソル行番号（1-indexed）
 */
export function updateTocHighlight(cursorLine) {
  // 前回と同じなら何もしない
  if (cursorLine === lastCursorLine) return;
  lastCursorLine = cursorLine;

  if (!tocContentEl) return;
  const items = tocContentEl.querySelectorAll(".toc-item");
  if (items.length === 0) return;

  let activeItem = null;

  // 見出しリストを走査し、カーソル行以前の最後の見出しを特定
  items.forEach((item) => {
    item.classList.remove("cursor-active");
    const line = parseInt(item.dataset.line, 10);
    if (line <= cursorLine) {
      activeItem = item;
    }
  });

  if (activeItem) {
    activeItem.classList.add("cursor-active");
    // アクティブ項目が TOC コンテンツの表示範囲外なら自動スクロール
    scrollIntoViewIfNeeded(activeItem);
  }
}

/**
 * エディタのビューポート範囲に基づいて、見出しの可視状態を更新する。
 * 表示範囲内にある見出しに viewport-visible クラスを付与する。
 *
 * 【パフォーマンス最適化】
 * - 前回と同じ範囲の場合は処理をスキップする
 *
 * @function updateTocViewport
 * @param {number} topLine - ビューポート上端の行番号（1-indexed）
 * @param {number} bottomLine - ビューポート下端の行番号（1-indexed）
 */
export function updateTocViewport(topLine, bottomLine) {
  // 前回と同じなら何もしない
  if (topLine === lastTopLine && bottomLine === lastBottomLine) return;
  lastTopLine = topLine;
  lastBottomLine = bottomLine;

  if (!tocContentEl) return;
  const items = tocContentEl.querySelectorAll(".toc-item");
  if (items.length === 0) return;

  items.forEach((item) => {
    const line = parseInt(item.dataset.line, 10);
    item.classList.toggle(
      "viewport-visible",
      line >= topLine && line <= bottomLine
    );
  });
}

/**
 * 要素が親コンテナの表示範囲外にある場合、スムーズスクロールで中央に表示する。
 *
 * @function scrollIntoViewIfNeeded
 * @param {HTMLElement} element - スクロール対象の要素
 */
function scrollIntoViewIfNeeded(element) {
  if (!tocContentEl) return;
  const cRect = tocContentEl.getBoundingClientRect();
  const eRect = element.getBoundingClientRect();

  // 要素がコンテナの表示範囲外にある場合のみスクロール
  if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
