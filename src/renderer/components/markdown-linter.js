/**
 * markdown-linter.js
 *
 * カスタム Markdown リンター。@codemirror/lint と統合し、
 * エディタ上のガターとパネルにリント結果を表示する。
 *
 * 【リントルール】
 * 1. checkHeadingLevelJumps — 見出しレベルの飛び (h1→h3 等) を警告
 * 2. checkEmptyListItems — 空のリスト項目を検出
 * 3. checkBrokenLinks — [text]() のような空リンクを警告
 * 4. checkConsecutiveBlankLines — 3行以上の連続空行を情報表示
 * 5. checkTrailingSpaces — 行末の余分なスペースをヒント表示
 *
 * 【動作フロー】
 * - 全ルールはコードブロック（``` ～ ```）内の行を除外する
 * - delay: 500ms で debounce（大きなドキュメントのパフォーマンス対策）
 * - Compartment で ON/OFF 切り替え可能
 *
 * @file markdown-linter.js
 * @version 0.1.10020
 * @since 0.1.10020
 * @revision 1
 * @lastModified 2026-03-01 00:00:00 (JST)
 */

import { linter, lintGutter } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";

/** localStorage キー */
const STORAGE_KEY = "mdpad:lintEnabled";

/** Compartment（エディタ拡張の動的切り替え用） */
const lintCompartment = new Compartment();

/** Lint の有効/無効状態（デフォルト: OFF） */
let lintEnabled = localStorage.getItem(STORAGE_KEY) === "true";

// ─── コードブロック除外ヘルパー ──────────────────────────────────────

/**
 * コードブロック内の行番号のセットを返す。
 * フェンスド コードブロック（``` ～ ```）の開始行と終了行の間を除外対象とする。
 *
 * @param {import("@codemirror/state").Text} doc - CodeMirror の Text オブジェクト
 * @returns {Set<number>} コードブロック内にある行番号のセット（1-indexed）
 */
function getCodeBlockLines(doc) {
  const codeLines = new Set();
  let inCodeBlock = false;

  for (let i = 1; i <= doc.lines; i++) {
    const lineText = doc.line(i).text;
    if (lineText.trimStart().startsWith("```")) {
      codeLines.add(i); // フェンス行自体も除外
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeLines.add(i);
    }
  }

  return codeLines;
}

// ─── リントルール ────────────────────────────────────────────────────

/**
 * 見出しレベルの飛びを検出する。
 * 例: h1 → h3（h2 をスキップ）は warning。
 *
 * @param {import("@codemirror/state").Text} doc - ドキュメント
 * @param {Set<number>} codeLines - コードブロック内の行番号セット
 * @returns {Array<import("@codemirror/lint").Diagnostic>} 診断結果配列
 */
function checkHeadingLevelJumps(doc, codeLines) {
  const diagnostics = [];
  let lastLevel = 0;

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) continue;

    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6})\s/);
    if (match) {
      const level = match[1].length;
      if (lastLevel > 0 && level > lastLevel + 1) {
        diagnostics.push({
          from: line.from,
          to: line.to,
          severity: "warning",
          message: `Heading level jumps from H${lastLevel} to H${level} (expected H${lastLevel + 1})`,
        });
      }
      lastLevel = level;
    }
  }

  return diagnostics;
}

/**
 * 空のリスト項目を検出する。
 * `- ` や `1. ` の後にテキストがない項目を検出する。
 *
 * @param {import("@codemirror/state").Text} doc - ドキュメント
 * @param {Set<number>} codeLines - コードブロック内の行番号セット
 * @returns {Array<import("@codemirror/lint").Diagnostic>} 診断結果配列
 */
function checkEmptyListItems(doc, codeLines) {
  const diagnostics = [];

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) continue;

    const line = doc.line(i);
    const text = line.text;

    // 空の箇条書きリスト: `- ` or `* ` or `+ ` with nothing after
    if (/^\s*[-*+]\s*$/.test(text)) {
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "info",
        message: "Empty list item",
      });
    }

    // 空の番号付きリスト: `1. ` with nothing after
    if (/^\s*\d+\.\s*$/.test(text)) {
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "info",
        message: "Empty numbered list item",
      });
    }

    // 空のタスクリスト: `- [ ] ` or `- [x] ` with nothing after
    if (/^\s*[-*+]\s+\[[ xX]\]\s*$/.test(text)) {
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "info",
        message: "Empty task list item",
      });
    }
  }

  return diagnostics;
}

/**
 * 空リンクを検出する。
 * `[text]()` のように URL が空のリンクを警告する。
 *
 * @param {import("@codemirror/state").Text} doc - ドキュメント
 * @param {Set<number>} codeLines - コードブロック内の行番号セット
 * @returns {Array<import("@codemirror/lint").Diagnostic>} 診断結果配列
 */
function checkBrokenLinks(doc, codeLines) {
  const diagnostics = [];
  // 空リンクのパターン: [テキスト]() — URL が空
  const emptyLinkRe = /\[([^\]]*)\]\(\s*\)/g;

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) continue;

    const line = doc.line(i);
    let match;
    while ((match = emptyLinkRe.exec(line.text)) !== null) {
      diagnostics.push({
        from: line.from + match.index,
        to: line.from + match.index + match[0].length,
        severity: "warning",
        message: `Empty link URL: [${match[1]}]()`,
      });
    }
  }

  return diagnostics;
}

/**
 * 3行以上の連続空行を検出する。
 * Markdown では1つの空行でパラグラフ区切りとなるため、
 * 3行以上の連続空行は通常不要。
 *
 * @param {import("@codemirror/state").Text} doc - ドキュメント
 * @param {Set<number>} codeLines - コードブロック内の行番号セット
 * @returns {Array<import("@codemirror/lint").Diagnostic>} 診断結果配列
 */
function checkConsecutiveBlankLines(doc, codeLines) {
  const diagnostics = [];
  let blankCount = 0;
  let blankStart = -1;

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) {
      blankCount = 0;
      continue;
    }

    const line = doc.line(i);
    if (line.text.trim() === "") {
      blankCount++;
      if (blankCount === 1) blankStart = i;
    } else {
      if (blankCount >= 3) {
        const startLine = doc.line(blankStart);
        const endLine = doc.line(blankStart + blankCount - 1);
        diagnostics.push({
          from: startLine.from,
          to: endLine.to,
          severity: "info",
          message: `${blankCount} consecutive blank lines (consider reducing to 1-2)`,
        });
      }
      blankCount = 0;
    }
  }

  // ファイル末尾のケース
  if (blankCount >= 3) {
    const startLine = doc.line(blankStart);
    const endLine = doc.line(blankStart + blankCount - 1);
    diagnostics.push({
      from: startLine.from,
      to: endLine.to,
      severity: "info",
      message: `${blankCount} consecutive blank lines at end of file`,
    });
  }

  return diagnostics;
}

/**
 * 行末の余分なスペースを検出する。
 * Markdown の意図的な改行（行末2スペース）は除外する。
 *
 * @param {import("@codemirror/state").Text} doc - ドキュメント
 * @param {Set<number>} codeLines - コードブロック内の行番号セット
 * @returns {Array<import("@codemirror/lint").Diagnostic>} 診断結果配列
 */
function checkTrailingSpaces(doc, codeLines) {
  const diagnostics = [];

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) continue;

    const line = doc.line(i);
    const text = line.text;

    // 行末のスペースを検出（ただし2スペースちょうどは Markdown の改行なので除外）
    const trailingMatch = text.match(/(\s+)$/);
    if (trailingMatch) {
      const spaces = trailingMatch[1];
      // 2スペースちょうどは意図的な改行の可能性が高いためスキップ
      if (spaces === "  ") continue;
      // 空行はスキップ
      if (text.trim() === "") continue;

      diagnostics.push({
        from: line.to - spaces.length,
        to: line.to,
        severity: "hint",
        message: `Trailing whitespace (${spaces.length} chars)`,
      });
    }
  }

  return diagnostics;
}

// ─── Linter Extension ────────────────────────────────────────────────

/**
 * 全リントルールを実行するメイン linter 関数を生成する。
 *
 * @returns {import("@codemirror/state").Extension} linter + lintGutter 拡張の配列
 */
function createLintExtensions() {
  return [
    linter((view) => {
      const doc = view.state.doc;
      const codeLines = getCodeBlockLines(doc);
      const diagnostics = [];

      diagnostics.push(...checkHeadingLevelJumps(doc, codeLines));
      diagnostics.push(...checkEmptyListItems(doc, codeLines));
      diagnostics.push(...checkBrokenLinks(doc, codeLines));
      diagnostics.push(...checkConsecutiveBlankLines(doc, codeLines));
      diagnostics.push(...checkTrailingSpaces(doc, codeLines));

      return diagnostics;
    }, { delay: 500 }),
    lintGutter(),
  ];
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Compartment ラップされた lint 拡張を返す。
 * createEditor() の extensions 配列に含めて使用する。
 *
 * @returns {import("@codemirror/state").Extension} Compartment 付き lint 拡張
 */
export function getLintExtension() {
  return lintCompartment.of(lintEnabled ? createLintExtensions() : []);
}

/**
 * Lint の ON/OFF を切り替える。
 * localStorage に状態を保存し、エディタの Compartment を再構成する。
 *
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 * @returns {boolean} 切り替え後の lint 有効状態
 */
export function toggleLint(view) {
  lintEnabled = !lintEnabled;
  localStorage.setItem(STORAGE_KEY, String(lintEnabled));
  view.dispatch({
    effects: lintCompartment.reconfigure(
      lintEnabled ? createLintExtensions() : []
    ),
  });
  return lintEnabled;
}

/**
 * Lint が有効かどうかを返す。
 *
 * @returns {boolean} lint の有効状態
 */
export function isLintEnabled() {
  return lintEnabled;
}

/**
 * Lint パネル（CodeMirror 組み込み）を開く。
 *
 * @param {import("@codemirror/view").EditorView} view - エディタビュー
 */
export function openLintPanelAction(view) {
  import("@codemirror/lint").then(({ openLintPanel }) => {
    openLintPanel(view);
  });
}
