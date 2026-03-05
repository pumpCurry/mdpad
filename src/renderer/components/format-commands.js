/**
 * @fileoverview CodeMirror 6 ベースの Markdown 書式エンジン。
 * インライン切替、行プレフィクス切替、ブロック挿入、書式状態検出を提供。
 * コンテキストメニュー、ツールバー、キーボードショートカットが共有するコマンドレジストリ。
 *
 * @description format-commands.js — Markdown formatting engine
 * @file format-commands.js
 * @module format-commands
 * @version 0.1.10020
 * @revision 2
 * @lastModified 2026-03-04 22:00:00 (JST)
 * @todo
 * - テーブル挿入時のセル選択サポート（$SELECT$ マーカー）
 */

import { keymap } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

// ─── Inline Format Toggle ───────────────────────────────────────────

/**
 * Toggle symmetric inline formatting (e.g. **bold**, *italic*, ~~strike~~, `code`).
 * - Selection present: wrap/unwrap selection with marker.
 * - No selection: if cursor inside marked region → remove markers; else insert marker pair and place cursor inside.
 */
export function toggleInlineFormat(view, marker) {
  const { state } = view;
  const changes = [];
  const selections = [];

  for (const range of state.selection.ranges) {
    const from = range.from;
    const to = range.to;
    const mLen = marker.length;

    if (from !== to) {
      // Has selection — check if already wrapped
      const selText = state.sliceDoc(from, to);
      const beforeOuter = state.sliceDoc(Math.max(0, from - mLen), from);
      const afterOuter = state.sliceDoc(to, Math.min(state.doc.length, to + mLen));

      if (beforeOuter === marker && afterOuter === marker) {
        // Remove outer markers
        changes.push({ from: from - mLen, to: from, insert: "" });
        changes.push({ from: to, to: to + mLen, insert: "" });
        selections.push({ anchor: from - mLen, head: to - mLen });
      } else if (selText.startsWith(marker) && selText.endsWith(marker) && selText.length >= mLen * 2) {
        // Selection includes markers — remove inner
        changes.push({ from, to, insert: selText.slice(mLen, -mLen) });
        selections.push({ anchor: from, head: to - mLen * 2 });
      } else {
        // Wrap selection
        changes.push({ from, to, insert: marker + selText + marker });
        selections.push({ anchor: from + mLen, head: to + mLen });
      }
    } else {
      // No selection — check if cursor is inside markers
      const lineObj = state.doc.lineAt(from);
      const lineText = lineObj.text;
      const col = from - lineObj.from;

      // Search backward and forward for marker on the current line
      const beforeOnLine = lineText.substring(0, col);
      const afterOnLine = lineText.substring(col);
      const lastOpen = beforeOnLine.lastIndexOf(marker);
      const firstClose = afterOnLine.indexOf(marker);

      if (lastOpen !== -1 && firstClose !== -1) {
        // Cursor is between markers — remove them
        const openAbs = lineObj.from + lastOpen;
        const closeAbs = from + firstClose;
        changes.push({ from: closeAbs, to: closeAbs + mLen, insert: "" });
        changes.push({ from: openAbs, to: openAbs + mLen, insert: "" });
        selections.push({ anchor: from - mLen });
      } else {
        // Insert empty marker pair
        changes.push({ from, to: from, insert: marker + marker });
        selections.push({ anchor: from + mLen });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({
      changes,
      selection: EditorSelection.create(
        selections.map(s => EditorSelection.range(s.anchor, s.head !== undefined ? s.head : s.anchor))
      ),
    });
  }
  return true;
}

// ─── Asymmetric Inline Toggle ───────────────────────────────────────

/**
 * Toggle asymmetric inline formatting (e.g. <kbd>...</kbd>).
 */
export function toggleAsymmetricInline(view, openTag, closeTag) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const oLen = openTag.length;
  const cLen = closeTag.length;

  if (from !== to) {
    const selText = state.sliceDoc(from, to);
    const beforeOuter = state.sliceDoc(Math.max(0, from - oLen), from);
    const afterOuter = state.sliceDoc(to, Math.min(state.doc.length, to + cLen));

    if (beforeOuter === openTag && afterOuter === closeTag) {
      view.dispatch({
        changes: [
          { from: from - oLen, to: from, insert: "" },
          { from: to, to: to + cLen, insert: "" },
        ],
        selection: { anchor: from - oLen, head: to - oLen },
      });
    } else if (selText.startsWith(openTag) && selText.endsWith(closeTag)) {
      const inner = selText.slice(oLen, -cLen);
      view.dispatch({
        changes: { from, to, insert: inner },
        selection: { anchor: from, head: from + inner.length },
      });
    } else {
      view.dispatch({
        changes: { from, to, insert: openTag + selText + closeTag },
        selection: { anchor: from + oLen, head: to + oLen },
      });
    }
  } else {
    // No selection — insert tags and place cursor inside
    view.dispatch({
      changes: { from, to: from, insert: openTag + closeTag },
      selection: { anchor: from + oLen },
    });
  }
  return true;
}

// ─── Line Prefix Toggle ─────────────────────────────────────────────

/**
 * 選択範囲（または現在行）の行プレフィクスを切り替える。
 *
 * 【詳細説明】
 * - 対象全行がすでに同じプレフィクスを持つ場合は削除（トグルOFF）
 * - それ以外の場合はプレフィクスを付与（トグルON）
 * - exclusive オプションで排他的プレフィクス（例: 見出しレベル切替）を処理
 * - numbered オプションで連番プレフィクス（1. 2. 3.）を自動付番
 * - 変更後のカーソル位置は明示的に計算し、元の相対位置を保持する
 *
 * @function toggleLinePrefix
 * @param {EditorView} view - CodeMirror EditorView インスタンス
 * @param {string} prefix - 行頭に付与するプレフィクス文字列（例: "# ", "- ", "> "）
 * @param {Object} [options={}] - オプション
 * @param {string[]} [options.exclusive] - 排他的プレフィクス配列（付与時に除去する）
 * @param {boolean} [options.numbered] - true の場合、連番プレフィクス（1. 2. ...）を使用
 * @returns {boolean} - 常に true（コマンド処理完了）
 */
export function toggleLinePrefix(view, prefix, options = {}) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  const changes = [];

  // 対象行を収集
  const lines = [];
  for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
    lines.push(state.doc.line(ln));
  }

  // 全行がすでにこのプレフィクスを持っているか判定
  const allHave = lines.every((line) => {
    if (options.numbered) {
      return /^\d+\.\s/.test(line.text);
    }
    return line.text.startsWith(prefix);
  });

  if (allHave) {
    // プレフィクスを全行から除去（トグルOFF）
    for (const line of lines) {
      if (options.numbered) {
        const m = line.text.match(/^\d+\.\s/);
        if (m) {
          changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
        }
      } else {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      }
    }
  } else {
    // プレフィクスを全行に付与（トグルON）
    let num = 1;
    for (const line of lines) {
      // 排他的プレフィクスを先に除去
      let removeLen = 0;
      if (options.exclusive) {
        for (const excl of options.exclusive) {
          if (line.text.startsWith(excl)) {
            removeLen = excl.length;
            break;
          }
        }
      }
      // 非連番モードで連番プレフィクスがある場合も除去
      if (!options.numbered && /^\d+\.\s/.test(line.text)) {
        const m = line.text.match(/^\d+\.\s/);
        if (m) removeLen = m[0].length;
      }
      // 同じプレフィクスが既にある行はスキップ（再付与不要）
      if (!options.numbered && line.text.startsWith(prefix)) {
        continue;
      }

      const insertText = options.numbered ? `${num++}. ` : prefix;
      changes.push({ from: line.from, to: line.from + removeLen, insert: insertText });
    }
  }

  if (changes.length > 0) {
    // 元のカーソル/選択位置を変更後のドキュメント上にマッピングし、明示的に設定
    // （デフォルトマッピング依存ではなく、toggleInlineFormat と同じパターンで制御）
    const changeDesc = state.changes(changes);
    const newFrom = changeDesc.mapPos(from, 1);
    const newTo = from === to ? newFrom : changeDesc.mapPos(to, 1);
    view.dispatch({
      changes,
      selection: from === to
        ? EditorSelection.cursor(newFrom)
        : EditorSelection.range(newFrom, newTo),
    });
  }
  return true;
}

// ─── Block Insert ────────────────────────────────────────────────────

/**
 * ブロックテンプレートをカーソル位置に挿入する。
 *
 * 【詳細説明】
 * - template が関数の場合、選択テキストを引数として呼び出す
 * - テンプレート内の `$0` をカーソル位置マーカーとして扱い、
 *   挿入後に `$0` の位置にカーソルを配置する（`$0` 自体は除去される）
 * - `$0` が無い場合はブロック末尾にカーソルを配置する
 * - ブロック前後に空行が必要な場合は自動挿入する
 * - カーソルが行の途中にある場合（前方にテキストがある場合）は
 *   改行を挿入してブロックが独立行になるようにする
 *
 * @function insertBlock
 * @param {EditorView} view - CodeMirror EditorView インスタンス
 * @param {string|function} template - 挿入テンプレート文字列、または (selText) => string の関数。
 *   テンプレート内に `$0` を含めるとカーソル位置を指定できる。
 * @returns {boolean} - 常に true（コマンド処理完了）
 */
export function insertBlock(view, template) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const selText = state.sliceDoc(from, to);

  const block = typeof template === "function" ? template(selText) : template;

  // カーソル位置マーカー `$0` を検出し、除去してカーソルオフセットを記録
  const CURSOR_MARKER = "$0";
  let blockClean = block;
  let cursorInBlock = -1;
  const markerIdx = blockClean.indexOf(CURSOR_MARKER);
  if (markerIdx !== -1) {
    cursorInBlock = markerIdx;
    blockClean = blockClean.slice(0, markerIdx) + blockClean.slice(markerIdx + CURSOR_MARKER.length);
  }

  // カーソルが行の途中にある場合、改行を挿入してブロックを独立行にする
  // （水平線 --- 等のブロック要素が文中に埋まるのを防止する）
  const lineObj = state.doc.lineAt(from);
  const textBeforeCursor = state.sliceDoc(lineObj.from, from);
  const needLineSplit = textBeforeCursor.length > 0 && from !== lineObj.from;

  // ブロック前の空行チェック（行頭にいて、前行が空でない場合）
  const prevLine = lineObj.number > 1 ? state.doc.line(lineObj.number - 1) : null;
  const needBlankBefore = !needLineSplit && prevLine && prevLine.text.trim() !== "" && from === lineObj.from;

  // 行分離が必要なら改行、空行が必要なら改行、それ以外は空文字
  const prefix = needLineSplit ? "\n" : (needBlankBefore ? "\n" : "");

  // ブロック後の空行チェック
  const endLineObj = state.doc.lineAt(to);
  const nextLine = endLineObj.number < state.doc.lines ? state.doc.line(endLineObj.number + 1) : null;
  const needBlankAfter = nextLine && nextLine.text.trim() !== "" && to === endLineObj.to;
  const suffix = needBlankAfter ? "\n" : "";

  const insertText = prefix + blockClean + suffix;

  // カーソル位置の計算: $0 マーカーがあればその位置、なければブロック末尾
  const anchor = cursorInBlock !== -1
    ? from + prefix.length + cursorInBlock
    : from + insertText.length;

  view.dispatch({
    changes: { from, to, insert: insertText },
    selection: { anchor },
  });
  return true;
}

// ─── Link & Image Insert ─────────────────────────────────────────────

export function insertLink(view) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const selText = state.sliceDoc(from, to);

  // If selected text looks like a URL, put it in the URL part
  const isUrl = /^https?:\/\//.test(selText);
  if (isUrl) {
    const insert = `[](${selText})`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + 1 }, // Cursor inside []
    });
  } else {
    const text = selText || "";
    const insert = `[${text}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + text.length + 3, head: from + text.length + 6 }, // Select "url"
    });
  }
  return true;
}

export function insertImage(view) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const selText = state.sliceDoc(from, to);

  const isUrl = /^https?:\/\//.test(selText);
  if (isUrl) {
    const insert = `![alt](${selText})`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + 2, head: from + 5 }, // Select "alt"
    });
  } else {
    const alt = selText || "alt";
    const insert = `![${alt}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + alt.length + 4, head: from + alt.length + 7 }, // Select "url"
    });
  }
  return true;
}

// ─── Escape ──────────────────────────────────────────────────────────

/**
 * Markdown 特殊文字をバックスラッシュでエスケープする。
 *
 * 【詳細説明】
 * - テキスト選択時: 選択範囲内の特殊文字をすべてエスケープし、
 *   エスケープ後のテキストを選択状態にする
 * - テキスト未選択時: カーソル位置にバックスラッシュを挿入し、
 *   カーソルをバックスラッシュの後ろに配置する
 *
 * @function insertEscape
 * @param {EditorView} view - CodeMirror EditorView インスタンス
 * @returns {boolean} - 常に true（コマンド処理完了）
 */
export function insertEscape(view) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;

  if (from !== to) {
    // 選択範囲の各特殊文字をエスケープし、結果を選択状態にする
    const selText = state.sliceDoc(from, to);
    const escaped = selText.replace(/([\\`*_{}\[\]()#+\-.!|~>])/g, "\\$1");
    view.dispatch({
      changes: { from, to, insert: escaped },
      selection: { anchor: from, head: from + escaped.length },
    });
  } else {
    // カーソル位置にバックスラッシュを挿入
    view.dispatch({
      changes: { from, to: from, insert: "\\" },
      selection: { anchor: from + 1 },
    });
  }
  return true;
}

// ─── Heading Helpers ─────────────────────────────────────────────────

const HEADING_PREFIXES = ["# ", "## ", "### ", "#### ", "##### ", "###### "];
const ALL_HEADING_PREFIXES = HEADING_PREFIXES; // Alias for clarity

function toggleHeading(view, level) {
  const prefix = "#".repeat(level) + " ";
  return toggleLinePrefix(view, prefix, { exclusive: ALL_HEADING_PREFIXES });
}

// ─── Task List ───────────────────────────────────────────────────────

/**
 * タスクリスト（チェックボックス）のプレフィクスを切り替える。
 *
 * 【詳細説明】
 * - 全行が `- [ ] ` または `- [x] ` で始まる場合は削除（トグルOFF）
 * - それ以外の場合は `- [ ] ` を付与（トグルON）
 * - 既存のリストマーカー（`- `, `* `, `1. ` 等）は自動で置き換え
 * - 変更後のカーソル位置は明示的に計算し、元の相対位置を保持する
 *
 * @function toggleTaskList
 * @param {EditorView} view - CodeMirror EditorView インスタンス
 * @returns {boolean} - 常に true（コマンド処理完了）
 */
export function toggleTaskList(view) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  const changes = [];

  const lines = [];
  for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
    lines.push(state.doc.line(ln));
  }

  const allHave = lines.every((l) => /^- \[([ x])\] /.test(l.text));

  if (allHave) {
    // タスクリストプレフィクスを全行から除去
    for (const line of lines) {
      const m = line.text.match(/^- \[[ x]\] /);
      if (m) {
        changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
      }
    }
  } else {
    // タスクリストプレフィクスを全行に付与
    for (const line of lines) {
      // 既存のリストマーカーがあれば置き換え
      let removeLen = 0;
      if (/^- \[[ x]\] /.test(line.text)) {
        continue; // 既にタスクリスト形式の行はスキップ
      } else if (line.text.startsWith("- ") || line.text.startsWith("* ")) {
        removeLen = 2;
      } else if (/^\d+\.\s/.test(line.text)) {
        const m = line.text.match(/^\d+\.\s/);
        if (m) removeLen = m[0].length;
      }
      changes.push({ from: line.from, to: line.from + removeLen, insert: "- [ ] " });
    }
  }

  if (changes.length > 0) {
    // 元のカーソル/選択位置を変更後のドキュメント上にマッピングし、明示的に設定
    const changeDesc = state.changes(changes);
    const newFrom = changeDesc.mapPos(from, 1);
    const newTo = from === to ? newFrom : changeDesc.mapPos(to, 1);
    view.dispatch({
      changes,
      selection: from === to
        ? EditorSelection.cursor(newFrom)
        : EditorSelection.range(newFrom, newTo),
    });
  }
  return true;
}

// ─── Format State Detection ──────────────────────────────────────────

/**
 * Check if a formatting type is currently active at the cursor/selection.
 * Returns true if the format is applied.
 */
export function isFormatActive(view, formatId) {
  if (!view) return false;
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const lineObj = state.doc.lineAt(from);

  switch (formatId) {
    case "bold":
      return isInlineActive(state, from, to, "**");
    case "italic":
      return isInlineActive(state, from, to, "*") && !isInlineActive(state, from, to, "**");
    case "strikethrough":
      return isInlineActive(state, from, to, "~~");
    case "inlineCode":
      return isInlineActive(state, from, to, "`");
    case "underline":
      return isAsymmetricActive(state, from, to, "<u>", "</u>");
    case "kbd":
      return isAsymmetricActive(state, from, to, "<kbd>", "</kbd>");
    case "h1": case "h2": case "h3":
    case "h4": case "h5": case "h6": {
      const level = parseInt(formatId[1]);
      const prefix = "#".repeat(level) + " ";
      return lineObj.text.startsWith(prefix);
    }
    case "bulletList":
      return lineObj.text.startsWith("- ") && !lineObj.text.startsWith("- [");
    case "numberedList":
      return /^\d+\.\s/.test(lineObj.text);
    case "taskList":
      return /^- \[[ x]\] /.test(lineObj.text);
    case "blockquote":
      return lineObj.text.startsWith("> ");
    default:
      return false;
  }
}

function isInlineActive(state, from, to, marker) {
  const mLen = marker.length;

  if (from !== to) {
    // Check if selection is wrapped by marker
    const before = state.sliceDoc(Math.max(0, from - mLen), from);
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + mLen));
    if (before === marker && after === marker) return true;
    const sel = state.sliceDoc(from, to);
    if (sel.startsWith(marker) && sel.endsWith(marker)) return true;
  }

  // Check if cursor is within markers on same line
  const lineObj = state.doc.lineAt(from);
  const lineText = lineObj.text;
  const col = from - lineObj.from;
  const before = lineText.substring(0, col);
  const after = lineText.substring(col);

  // Count marker occurrences to check if inside a pair
  const beforeIdx = before.lastIndexOf(marker);
  const afterIdx = after.indexOf(marker);
  return beforeIdx !== -1 && afterIdx !== -1;
}

function isAsymmetricActive(state, from, to, openTag, closeTag) {
  const oLen = openTag.length;
  const cLen = closeTag.length;

  if (from !== to) {
    const before = state.sliceDoc(Math.max(0, from - oLen), from);
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + cLen));
    if (before === openTag && after === closeTag) return true;
  }

  // Check cursor context
  const lineObj = state.doc.lineAt(from);
  const lineText = lineObj.text;
  const col = from - lineObj.from;
  const before = lineText.substring(0, col);
  const after = lineText.substring(col);
  return before.lastIndexOf(openTag) !== -1 && after.indexOf(closeTag) !== -1;
}

// ─── Command Registry ────────────────────────────────────────────────

/**
 * FORMAT_COMMANDS: master registry of all format commands.
 * Each entry: { id, fn(view), icon, shortcut?, i18nKey, group }
 *
 * Groups: inline, link, heading, list, block, extra
 */
export const FORMAT_COMMANDS = [
  // ── Inline ──
  {
    id: "bold",
    fn: (view) => toggleInlineFormat(view, "**"),
    icon: "B",
    iconStyle: "font-weight:bold",
    shortcut: "Ctrl+B",
    i18nKey: "format.bold",
    group: "inline",
    toggle: true,
  },
  {
    id: "italic",
    fn: (view) => toggleInlineFormat(view, "*"),
    icon: "I",
    iconStyle: "font-style:italic",
    shortcut: "Ctrl+I",
    i18nKey: "format.italic",
    group: "inline",
    toggle: true,
  },
  {
    id: "strikethrough",
    fn: (view) => toggleInlineFormat(view, "~~"),
    icon: "S",
    iconStyle: "text-decoration:line-through",
    shortcut: "Ctrl+Shift+S",
    i18nKey: "format.strikethrough",
    group: "inline",
    toggle: true,
  },
  {
    id: "inlineCode",
    fn: (view) => toggleInlineFormat(view, "`"),
    icon: "<>",
    iconStyle: "font-family:monospace;font-size:11px",
    shortcut: "Ctrl+`",
    i18nKey: "format.inlineCode",
    group: "inline",
    toggle: true,
  },
  {
    id: "underline",
    fn: (view) => toggleAsymmetricInline(view, "<u>", "</u>"),
    icon: "U",
    iconStyle: "text-decoration:underline",
    shortcut: "Ctrl+U",
    i18nKey: "format.underline",
    group: "inline",
    toggle: true,
  },

  // ── Link / Image ──
  {
    id: "link",
    fn: (view) => insertLink(view),
    icon: "\uD83D\uDD17",
    shortcut: "Ctrl+Shift+K",
    i18nKey: "format.link",
    group: "link",
  },
  {
    id: "image",
    fn: (view) => insertImage(view),
    icon: "\uD83D\uDDBC",
    i18nKey: "format.image",
    group: "link",
  },

  // ── Headings ──
  {
    id: "h1",
    fn: (view) => toggleHeading(view, 1),
    icon: "H1",
    i18nKey: "format.h1",
    group: "heading",
    toggle: true,
  },
  {
    id: "h2",
    fn: (view) => toggleHeading(view, 2),
    icon: "H2",
    i18nKey: "format.h2",
    group: "heading",
    toggle: true,
  },
  {
    id: "h3",
    fn: (view) => toggleHeading(view, 3),
    icon: "H3",
    i18nKey: "format.h3",
    group: "heading",
    toggle: true,
  },
  {
    id: "h4",
    fn: (view) => toggleHeading(view, 4),
    icon: "H4",
    i18nKey: "format.h4",
    group: "heading",
    toggle: true,
  },
  {
    id: "h5",
    fn: (view) => toggleHeading(view, 5),
    icon: "H5",
    i18nKey: "format.h5",
    group: "heading",
    toggle: true,
  },
  {
    id: "h6",
    fn: (view) => toggleHeading(view, 6),
    icon: "H6",
    i18nKey: "format.h6",
    group: "heading",
    toggle: true,
  },

  // ── Lists ──
  {
    id: "bulletList",
    fn: (view) => toggleLinePrefix(view, "- "),
    icon: "\u2022",
    i18nKey: "format.bulletList",
    group: "list",
    toggle: true,
  },
  {
    id: "numberedList",
    fn: (view) => toggleLinePrefix(view, "1. ", { numbered: true }),
    icon: "1.",
    i18nKey: "format.numberedList",
    group: "list",
    toggle: true,
  },
  {
    id: "taskList",
    fn: (view) => toggleTaskList(view),
    icon: "\u2611",
    i18nKey: "format.taskList",
    group: "list",
    toggle: true,
  },
  {
    id: "blockquote",
    fn: (view) => toggleLinePrefix(view, "> "),
    icon: "\u275D",
    i18nKey: "format.blockquote",
    group: "list",
    toggle: true,
  },
  {
    id: "codeBlock",
    fn: (view) =>
      insertBlock(view, (sel) =>
        sel ? "```\n" + sel + "\n```" : "```\n$0\n```"
      ),
    icon: "{ }",
    iconStyle: "font-family:monospace;font-size:10px",
    i18nKey: "format.codeBlock",
    group: "block",
  },

  // ── Block ──
  {
    id: "table",
    fn: (view) =>
      insertBlock(
        view,
        "| $0Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| cell | cell | cell |"
      ),
    icon: "\u25A6",
    i18nKey: "format.table",
    group: "block",
  },
  {
    id: "horizontalRule",
    fn: (view) => insertBlock(view, "---\n$0"),
    icon: "\u2500",
    i18nKey: "format.horizontalRule",
    group: "block",
  },
  {
    id: "details",
    fn: (view) =>
      insertBlock(
        view,
        (sel) =>
          `<details>\n<summary>Summary</summary>\n\n$0${sel || "Content"}\n\n</details>`
      ),
    icon: "\u25B6",
    i18nKey: "format.details",
    group: "extra",
  },
  {
    id: "definitionList",
    fn: (view) =>
      insertBlock(view, (sel) =>
        sel
          ? `${sel}\n: $0Definition`
          : "$0Term\n: Definition"
      ),
    icon: "DL",
    iconStyle: "font-size:10px;font-weight:bold",
    i18nKey: "format.definitionList",
    group: "extra",
  },
  {
    id: "kbd",
    fn: (view) => toggleAsymmetricInline(view, "<kbd>", "</kbd>"),
    icon: "\u2328",
    i18nKey: "format.kbd",
    group: "extra",
    toggle: true,
  },
  {
    id: "escape",
    fn: (view) => insertEscape(view),
    icon: "\\",
    iconStyle: "font-family:monospace;font-weight:bold",
    i18nKey: "format.escape",
    group: "extra",
  },
  {
    id: "color",
    fn: null, // Opens color palette overlay (handled by format-toolbar/context-menu)
    icon: "\uD83C\uDFA8",
    i18nKey: "format.color",
    group: "extra",
  },
];

/**
 * Insert color-wrapped text: <span style="color:HEX">selection</span>
 */
export function insertColor(view, color) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const selText = state.sliceDoc(from, to) || "text";
  const open = `<span style="color:${color}">`;
  const close = "</span>";
  const insert = open + selText + close;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + open.length, head: from + open.length + selText.length },
  });
  return true;
}

/** Lookup command by ID */
export function getFormatCommand(id) {
  return FORMAT_COMMANDS.find((c) => c.id === id);
}

// ─── Keyboard Shortcut Keymap ────────────────────────────────────────

/**
 * Returns a CodeMirror keymap extension for format shortcuts.
 * Usage: add getFormatKeymap() to the editor's extensions array.
 */
export function getFormatKeymap() {
  return keymap.of([
    {
      key: "Mod-b",
      run: (view) => toggleInlineFormat(view, "**"),
    },
    {
      key: "Mod-i",
      run: (view) => toggleInlineFormat(view, "*"),
    },
    {
      key: "Mod-Shift-s",
      run: (view) => toggleInlineFormat(view, "~~"),
    },
    {
      key: "Mod-`",
      run: (view) => toggleInlineFormat(view, "`"),
    },
    {
      key: "Mod-u",
      run: (view) => toggleAsymmetricInline(view, "<u>", "</u>"),
    },
    {
      key: "Mod-Shift-k",
      run: (view) => insertLink(view),
    },
  ]);
}
