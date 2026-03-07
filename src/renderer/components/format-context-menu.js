/**
 * @fileoverview エディタペインの右クリックコンテキストメニュー。
 * レベル1に基本編集操作（元に戻す/やり直し/切り取り/コピー/貼り付け/全選択）を配置し、
 * Markdown 書式コマンドは「装飾 ▸」サブメニュー（レベル2）にまとめる。
 * 見出し・カラーはさらにレベル3のフライアウトで表示。
 *
 * @description format-context-menu.js — Right-click context menu
 * @file format-context-menu.js
 * @module format-context-menu
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 3
 * @lastModified 2026-03-07 20:00:00 (JST)
 */

import { FORMAT_COMMANDS, isFormatActive, getFormatCommand, insertColor, getColorHistory } from "./format-commands.js";
import { getEditor } from "./editor-pane.js";
import { t } from "../../i18n/i18n-renderer.js";

/** メインメニュー要素 */
let menuEl = null;
/** 装飾サブメニュー（レベル2）要素 */
let formattingSubmenuEl = null;
/** 見出しサブメニュー（レベル3）要素 */
let headingSubmenuEl = null;
/** カラーパレット（レベル3）要素 */
let colorPaletteEl = null;

/** ステータスバーの高さ（px）— フッターバーへの食い込み防止に使用 */
const STATUS_BAR_HEIGHT = 24;

/** カラーパレットのプリセット色（6列 x 4行 = 24色） */
const COLOR_PRESETS = [
  "#cf222e", "#bf8700", "#1a7f37", "#0969da", "#8250df", "#e16f24",
  "#ff8182", "#d4a72c", "#4ac26b", "#54aeff", "#c297ff", "#ffa657",
  "#82071e", "#6c4400", "#044f1e", "#033d8b", "#512a97", "#953800",
  "#24292f", "#57606a", "#8b949e", "#d0d7de", "#f6f8fa", "#ffffff",
];

// ─── 初期化 ──────────────────────────────────────────────────────────

/**
 * コンテキストメニューを初期化する。
 * エディタペインにcontextmenuイベントリスナを登録し、
 * 外部クリック・Escape・ポップアップイベントでの自動閉じを設定する。
 *
 * @function initFormatContextMenu
 * @returns {void}
 */
export function initFormatContextMenu() {
  const editorPane = document.getElementById("editor-pane");
  if (!editorPane) return;

  editorPane.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  });

  // メニュー外クリックで閉じる（サブメニュー・パレット内のクリックは除外）
  document.addEventListener("mousedown", (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      if (formattingSubmenuEl && formattingSubmenuEl.contains(e.target)) return;
      if (headingSubmenuEl && headingSubmenuEl.contains(e.target)) return;
      if (colorPaletteEl && colorPaletteEl.contains(e.target)) return;
      closeContextMenu();
    }
  });
  // Escape キーで閉じる
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl) {
      closeContextMenu();
    }
  });

  // モーダルダイアログ表示時に閉じる
  window.addEventListener("mdpad:closePopups", () => closeContextMenu());
}

// ─── メニュー表示 ────────────────────────────────────────────────────

/**
 * コンテキストメニューを表示する。
 * レベル1: 基本編集操作 + 「装飾 ▸」サブメニュートリガー。
 * ステータスバー（24px）に食い込まないよう位置計算を行う。
 *
 * @function showContextMenu
 * @param {number} x - 右クリック位置の clientX
 * @param {number} y - 右クリック位置の clientY
 * @returns {void}
 */
function showContextMenu(x, y) {
  closeContextMenu();

  const view = getEditor();
  if (!view) return;

  menuEl = document.createElement("div");
  menuEl.className = "format-context-menu";

  const { state } = view;
  const hasSelection = !state.selection.main.empty;

  // ── 基本編集操作（レベル1） ──

  // 元に戻す / やり直し
  // undoDepth / redoDepth は @codemirror/commands から取得できるが、
  // 動的インポートの非同期処理がメニュー描画に間に合わないため、常に有効として表示する。
  // undo/redo 自体は実行時に動的インポートで取得する（既存 index.js と同じパターン）。
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_undo"),
    icon: "↩",
    shortcut: "Ctrl+Z",
    disabled: false,
    onClick: () => {
      const v = getEditor();
      if (v) {
        import("@codemirror/commands").then(({ undo }) => {
          undo(v);
          v.focus();
        });
      }
    },
  }));
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_redo"),
    icon: "↪",
    shortcut: "Ctrl+Y",
    disabled: false,
    onClick: () => {
      const v = getEditor();
      if (v) {
        import("@codemirror/commands").then(({ redo }) => {
          redo(v);
          v.focus();
        });
      }
    },
  }));

  menuEl.appendChild(createSeparator());

  // 切り取り / コピー / 貼り付け
  // CodeMirror 6 の contenteditable 上で document.execCommand が動作する
  // （Electron の Chromium ベースで互換性維持されている）
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_cut"),
    icon: "✂",
    shortcut: "Ctrl+X",
    disabled: !hasSelection,
    onClick: () => {
      const v = getEditor();
      if (v) {
        v.focus();
        document.execCommand("cut");
      }
    },
  }));
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_copy"),
    icon: "📋",
    shortcut: "Ctrl+C",
    disabled: !hasSelection,
    onClick: () => {
      const v = getEditor();
      if (v) {
        v.focus();
        document.execCommand("copy");
      }
    },
  }));
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_paste"),
    icon: "📄",
    shortcut: "Ctrl+V",
    disabled: false,
    onClick: () => {
      const v = getEditor();
      if (v) {
        v.focus();
        document.execCommand("paste");
      }
    },
  }));

  menuEl.appendChild(createSeparator());

  // すべて選択
  menuEl.appendChild(createEditItem({
    label: t("menu.edit_selectAll"),
    icon: "▣",
    shortcut: "Ctrl+A",
    disabled: false,
    onClick: () => {
      const v = getEditor();
      if (v) {
        v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
        v.focus();
      }
    },
  }));

  menuEl.appendChild(createSeparator());

  // ── 装飾サブメニュー（レベル2へのトリガー） ──
  menuEl.appendChild(createFormattingSubmenuTrigger(view));

  document.body.appendChild(menuEl);

  // ── 位置計算（ステータスバー24pxを考慮） ──
  const rect = menuEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const usableH = vh - STATUS_BAR_HEIGHT;

  if (x + rect.width > vw) x = vw - rect.width - 4;
  if (y + rect.height > usableH) y = usableH - rect.height - 4;
  if (x < 0) x = 4;
  if (y < 0) y = 4;

  menuEl.style.left = x + "px";
  menuEl.style.top = y + "px";
}

// ─── 閉じる処理 ──────────────────────────────────────────────────────

/**
 * 全てのメニュー・サブメニュー・パレットを閉じる。
 *
 * @function closeContextMenu
 * @returns {void}
 */
function closeContextMenu() {
  closeFormattingSubmenu();
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

/**
 * 装飾サブメニューとその子（見出し・カラー）を閉じる。
 *
 * @function closeFormattingSubmenu
 * @returns {void}
 */
function closeFormattingSubmenu() {
  closeHeadingSubmenu();
  closeColorPalette();
  if (formattingSubmenuEl) {
    formattingSubmenuEl.remove();
    formattingSubmenuEl = null;
  }
}

/**
 * 見出しサブメニュー（レベル3）を閉じる。
 *
 * @function closeHeadingSubmenu
 * @returns {void}
 */
function closeHeadingSubmenu() {
  if (headingSubmenuEl) {
    headingSubmenuEl.remove();
    headingSubmenuEl = null;
  }
}

/**
 * カラーパレット（レベル3）を閉じる。
 *
 * @function closeColorPalette
 * @returns {void}
 */
function closeColorPalette() {
  if (colorPaletteEl) {
    colorPaletteEl.remove();
    colorPaletteEl = null;
  }
}

// ─── メニュー項目生成 ────────────────────────────────────────────────

/**
 * セパレーター要素を生成する。
 *
 * @function createSeparator
 * @returns {HTMLDivElement} - セパレーター div 要素
 */
function createSeparator() {
  const sep = document.createElement("div");
  sep.className = "fcm-separator";
  return sep;
}

/**
 * 基本編集操作用のメニューアイテムを生成する。
 * チェックマーク不要、disabled 対応あり。
 *
 * @function createEditItem
 * @param {Object} opts - 設定オブジェクト
 * @param {string} opts.label - 表示ラベル
 * @param {string} opts.icon - アイコン文字
 * @param {string} [opts.shortcut] - ショートカット表示テキスト
 * @param {boolean} opts.disabled - 無効状態か
 * @param {Function} opts.onClick - クリック時のコールバック
 * @returns {HTMLDivElement} - メニューアイテム div 要素
 */
function createEditItem({ label, icon, shortcut, disabled, onClick }) {
  const item = document.createElement("div");
  item.className = "fcm-item" + (disabled ? " disabled" : "");

  // チェックマーク領域（幅合わせのため空スパンを配置）
  const check = document.createElement("span");
  check.className = "fcm-check";
  item.appendChild(check);

  // アイコン
  const iconEl = document.createElement("span");
  iconEl.className = "fcm-icon";
  iconEl.textContent = icon;
  item.appendChild(iconEl);

  // ラベル
  const labelEl = document.createElement("span");
  labelEl.className = "fcm-label";
  labelEl.textContent = label;
  item.appendChild(labelEl);

  // ショートカット表示
  if (shortcut) {
    const shortcutEl = document.createElement("span");
    shortcutEl.className = "fcm-shortcut";
    shortcutEl.textContent = shortcut;
    item.appendChild(shortcutEl);
  }

  if (!disabled) {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
      onClick();
    });
  }

  return item;
}

/**
 * 装飾コマンド用のメニューアイテムを生成する。
 * チェックマーク（アクティブ状態検出）付き。
 *
 * @function createMenuItem
 * @param {Object} cmd - FORMAT_COMMANDS のコマンドオブジェクト
 * @returns {HTMLDivElement} - メニューアイテム div 要素
 */
function createMenuItem(cmd) {
  const view = getEditor();
  const item = document.createElement("div");
  item.className = "fcm-item";

  const isActive = view && cmd.toggle ? isFormatActive(view, cmd.id) : false;
  if (isActive) item.classList.add("active");

  // チェックマーク
  const check = document.createElement("span");
  check.className = "fcm-check";
  check.textContent = isActive ? "\u2713" : "";
  item.appendChild(check);

  // アイコン
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = cmd.icon;
  if (cmd.iconStyle) icon.style.cssText = cmd.iconStyle;
  item.appendChild(icon);

  // ラベル
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t(cmd.i18nKey);
  item.appendChild(label);

  // ショートカット
  if (cmd.shortcut) {
    const shortcut = document.createElement("span");
    shortcut.className = "fcm-shortcut";
    shortcut.textContent = cmd.shortcut;
    item.appendChild(shortcut);
  }

  item.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    // cmd.fn() → focus() の順序でツールバー（format-toolbar.js）と統一
    // cmd.fn() は view.state.selection を直接読むためフォーカス有無に非依存
    // focus() は dispatch 完了後にユーザー入力を受け付けるための後処理
    const currentView = getEditor();
    if (currentView && cmd.fn) {
      cmd.fn(currentView);
      currentView.focus();
    }
  });

  return item;
}

// ─── 装飾サブメニュー（レベル2） ─────────────────────────────────────

/**
 * レベル1の「装飾 ▸」トリガーアイテムを生成する。
 * ホバー時にレベル2の装飾サブメニューをフライアウト表示する。
 *
 * @function createFormattingSubmenuTrigger
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 * @returns {HTMLDivElement} - サブメニュートリガー div 要素
 */
function createFormattingSubmenuTrigger(view) {
  const container = document.createElement("div");
  container.className = "fcm-item has-submenu";

  // チェックマーク領域（装飾全体のチェックは不要なので空）
  const check = document.createElement("span");
  check.className = "fcm-check";
  container.appendChild(check);

  // アイコン
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = "✏";
  container.appendChild(icon);

  // ラベル
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.formatting");
  container.appendChild(label);

  // 矢印
  const arrow = document.createElement("span");
  arrow.className = "fcm-arrow";
  arrow.textContent = "\u25B6";
  container.appendChild(arrow);

  let hoverTimeout = null;

  /**
   * 装飾サブメニュー（レベル2）を表示する。
   * 全装飾コマンドをグループ分けしてセパレーター区切りで配置。
   * 見出しとカラーはさらにレベル3のフライアウトとして配置。
   */
  function showFormattingSubmenu() {
    if (formattingSubmenuEl) return;

    formattingSubmenuEl = document.createElement("div");
    formattingSubmenuEl.className = "fcm-submenu";

    // 装飾コマンドのグループ定義（元のレベル1構造を踏襲）
    const groups = [
      // インライン装飾
      { items: ["bold", "italic", "underline", "strikethrough", "inlineCode"] },
      // リンク・画像
      { items: ["link", "image"] },
      // 見出し（レベル3サブメニュー）
      { items: ["heading_submenu"] },
      // リスト・ブロック
      { items: ["bulletList", "numberedList", "taskList", "blockquote", "codeBlock"] },
      // 拡張ブロック
      { items: ["table", "horizontalRule", "details", "definitionList", "kbd", "escape", "color"] },
    ];

    groups.forEach((group, gi) => {
      group.items.forEach((itemId) => {
        if (itemId === "heading_submenu") {
          formattingSubmenuEl.appendChild(createHeadingSubmenu(view));
        } else if (itemId === "color") {
          formattingSubmenuEl.appendChild(createColorMenuItem());
        } else {
          const cmd = getFormatCommand(itemId);
          if (!cmd) return;
          formattingSubmenuEl.appendChild(createMenuItem(cmd));
        }
      });

      // グループ間にセパレーター（最後のグループの後は不要）
      if (gi < groups.length - 1) {
        formattingSubmenuEl.appendChild(createSeparator());
      }
    });

    document.body.appendChild(formattingSubmenuEl);

    // 位置計算（トリガーアイテムの右側に配置、ステータスバー考慮）
    const itemRect = container.getBoundingClientRect();
    formattingSubmenuEl.style.left = (itemRect.right + 2) + "px";
    formattingSubmenuEl.style.top = itemRect.top + "px";

    // ビューポート境界チェック（右端・下端のステータスバー手前）
    const subRect = formattingSubmenuEl.getBoundingClientRect();
    if (subRect.right > window.innerWidth) {
      formattingSubmenuEl.style.left = (itemRect.left - subRect.width - 2) + "px";
    }
    const usableH = window.innerHeight - STATUS_BAR_HEIGHT;
    if (subRect.bottom > usableH) {
      formattingSubmenuEl.style.top = (usableH - subRect.height - 4) + "px";
    }

    // マウスが離れたらサブメニューを閉じる（150ms 遅延で猶予）
    formattingSubmenuEl.addEventListener("mouseleave", () => {
      hoverTimeout = setTimeout(closeFormattingSubmenu, 150);
    });
    formattingSubmenuEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
  }

  container.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimeout);
    showFormattingSubmenu();
  });
  container.addEventListener("mouseleave", () => {
    hoverTimeout = setTimeout(closeFormattingSubmenu, 150);
  });

  // トリガー自体のクリックではメニューを閉じない
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}

// ─── 見出しサブメニュー（レベル3） ───────────────────────────────────

/**
 * 見出しサブメニューのトリガーアイテムを生成する。
 * ホバー時に H1-H6 のフライアウト（レベル3）を表示する。
 *
 * @function createHeadingSubmenu
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 * @returns {HTMLDivElement} - サブメニュートリガー div 要素
 */
function createHeadingSubmenu(view) {
  const container = document.createElement("div");
  container.className = "fcm-item has-submenu";

  // いずれかの見出しがアクティブかチェック
  let activeHeading = false;
  for (let i = 1; i <= 6; i++) {
    if (isFormatActive(view, `h${i}`)) {
      activeHeading = true;
      break;
    }
  }

  // チェックマーク
  const check = document.createElement("span");
  check.className = "fcm-check";
  check.textContent = activeHeading ? "\u2713" : "";
  container.appendChild(check);

  // アイコン
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = "H";
  icon.style.cssText = "font-weight:bold";
  container.appendChild(icon);

  // ラベル
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.heading");
  container.appendChild(label);

  // 矢印
  const arrow = document.createElement("span");
  arrow.className = "fcm-arrow";
  arrow.textContent = "\u25B6";
  container.appendChild(arrow);

  let hoverTimeout = null;

  /**
   * 見出し H1-H6 のフライアウトサブメニューを表示する。
   */
  function showSubmenu() {
    if (headingSubmenuEl) return;

    headingSubmenuEl = document.createElement("div");
    headingSubmenuEl.className = "fcm-submenu";

    for (let i = 1; i <= 6; i++) {
      const cmd = getFormatCommand(`h${i}`);
      if (cmd) {
        headingSubmenuEl.appendChild(createMenuItem(cmd));
      }
    }

    document.body.appendChild(headingSubmenuEl);

    // 位置計算（トリガーアイテムの右側）
    const itemRect = container.getBoundingClientRect();
    headingSubmenuEl.style.left = (itemRect.right + 2) + "px";
    headingSubmenuEl.style.top = itemRect.top + "px";

    // ビューポート境界チェック（ステータスバー考慮）
    const subRect = headingSubmenuEl.getBoundingClientRect();
    if (subRect.right > window.innerWidth) {
      headingSubmenuEl.style.left = (itemRect.left - subRect.width - 2) + "px";
    }
    const usableH = window.innerHeight - STATUS_BAR_HEIGHT;
    if (subRect.bottom > usableH) {
      headingSubmenuEl.style.top = (usableH - subRect.height - 4) + "px";
    }

    // マウスが離れたら閉じる（150ms 遅延）
    headingSubmenuEl.addEventListener("mouseleave", () => {
      hoverTimeout = setTimeout(closeHeadingSubmenu, 150);
    });
    headingSubmenuEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
  }

  container.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimeout);
    showSubmenu();
  });
  container.addEventListener("mouseleave", () => {
    hoverTimeout = setTimeout(closeHeadingSubmenu, 150);
  });

  // トリガー自体のクリックではメニューを閉じない
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}

// ─── カラーパレット（レベル3） ───────────────────────────────────────

/**
 * カラーパレットのトリガーアイテムを生成する。
 * ホバー時に24色プリセット + 色履歴 + カスタムカラーピッカーのフライアウトを表示。
 *
 * @function createColorMenuItem
 * @returns {HTMLDivElement} - サブメニュートリガー div 要素
 */
function createColorMenuItem() {
  const container = document.createElement("div");
  container.className = "fcm-item has-submenu";

  // チェックマーク（空）
  const check = document.createElement("span");
  check.className = "fcm-check";
  container.appendChild(check);

  // アイコン
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = "\uD83C\uDFA8";
  container.appendChild(icon);

  // ラベル
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.color");
  container.appendChild(label);

  // 矢印
  const arrow = document.createElement("span");
  arrow.className = "fcm-arrow";
  arrow.textContent = "\u25B6";
  container.appendChild(arrow);

  let hoverTimeout = null;

  /**
   * カラーパレットのフライアウトを表示する。
   * プリセット色グリッド → 色履歴（あれば）→ カスタムカラー入力行の構成。
   */
  function showPalette() {
    if (colorPaletteEl) return;

    colorPaletteEl = document.createElement("div");
    colorPaletteEl.className = "fcm-submenu fcm-color-palette";

    // ── プリセット色グリッド（6列 x 4行） ──
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:4px;";

    COLOR_PRESETS.forEach((color) => {
      const swatch = createColorSwatch(color);
      grid.appendChild(swatch);
    });

    colorPaletteEl.appendChild(grid);

    // ── 色履歴セクション（履歴があれば表示） ──
    const history = getColorHistory();
    if (history.length > 0) {
      const histLabel = document.createElement("div");
      histLabel.className = "fcm-color-history-label";
      histLabel.textContent = t("format.recentColors");
      colorPaletteEl.appendChild(histLabel);

      const histGrid = document.createElement("div");
      histGrid.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:4px;";

      history.forEach((color) => {
        const swatch = createColorSwatch(color);
        histGrid.appendChild(swatch);
      });

      colorPaletteEl.appendChild(histGrid);
    }

    // ── カスタムカラー入力行 ──
    const customRow = document.createElement("div");
    customRow.style.cssText = "display:flex;gap:4px;margin-top:6px;align-items:center;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = "#0969da";
    colorInput.style.cssText = "width:28px;height:24px;padding:0;border:1px solid #d0d7de;border-radius:4px;cursor:pointer;";
    // カラーピッカーのクリックでメニュー閉じを防止
    colorInput.addEventListener("mousedown", (e) => e.stopPropagation());

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText =
      "flex:1;height:24px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;cursor:pointer;font-size:11px;color:#24292f;";
    applyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
      const currentView = getEditor();
      if (currentView) {
        currentView.focus();
        insertColor(currentView, colorInput.value);
      }
    });

    customRow.appendChild(colorInput);
    customRow.appendChild(applyBtn);
    colorPaletteEl.appendChild(customRow);

    document.body.appendChild(colorPaletteEl);

    // 位置計算（トリガーアイテムの右側、ステータスバー考慮）
    const itemRect = container.getBoundingClientRect();
    colorPaletteEl.style.left = (itemRect.right + 2) + "px";
    colorPaletteEl.style.top = itemRect.top + "px";

    const palRect = colorPaletteEl.getBoundingClientRect();
    if (palRect.right > window.innerWidth) {
      colorPaletteEl.style.left = (itemRect.left - palRect.width - 2) + "px";
    }
    const usableH = window.innerHeight - STATUS_BAR_HEIGHT;
    if (palRect.bottom > usableH) {
      colorPaletteEl.style.top = (usableH - palRect.height - 4) + "px";
    }

    // マウスが離れたら閉じる（150ms 遅延）
    colorPaletteEl.addEventListener("mouseleave", () => {
      hoverTimeout = setTimeout(closeColorPalette, 150);
    });
    colorPaletteEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
  }

  container.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimeout);
    showPalette();
  });
  container.addEventListener("mouseleave", () => {
    hoverTimeout = setTimeout(closeColorPalette, 150);
  });

  // トリガー自体のクリックではメニューを閉じない
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}

/**
 * カラースウォッチ（色選択ボタン）を生成する。
 * クリック時に即座に色を挿入してメニューを閉じる。
 * プリセット・履歴の両方で共用する。
 *
 * @function createColorSwatch
 * @param {string} color - 16進カラーコード
 * @returns {HTMLButtonElement} - カラースウォッチ button 要素
 */
function createColorSwatch(color) {
  const swatch = document.createElement("button");
  swatch.style.cssText =
    `width:26px;height:26px;border-radius:4px;border:1px solid #d0d7de;cursor:pointer;background:${color};padding:0;`;
  // 白色は枠線を暗くして視認性を確保
  if (color === "#ffffff") swatch.style.border = "1px solid #8b949e";
  swatch.title = color;
  swatch.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    const currentView = getEditor();
    if (currentView) {
      currentView.focus();
      insertColor(currentView, color);
    }
  });
  return swatch;
}
