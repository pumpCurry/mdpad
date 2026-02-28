/**
 * format-commands.js
 *
 * CodeMirror 6 based Markdown formatting engine.
 * Provides inline toggle, line prefix toggle, block insert, and format state detection.
 * Shared command registry used by context menu, toolbar, and keyboard shortcuts.
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
 * Toggle a line prefix for the line(s) covered by the selection.
 * Options:
 *   exclusive: string[] — other prefixes to remove when applying (e.g., heading levels)
 *   numbered: boolean — auto-number lines (1. 2. 3. ...)
 */
export function toggleLinePrefix(view, prefix, options = {}) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  const changes = [];

  // Collect lines
  const lines = [];
  for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
    lines.push(state.doc.line(ln));
  }

  // Check if ALL lines already have this prefix
  const allHave = lines.every((line) => {
    if (options.numbered) {
      return /^\d+\.\s/.test(line.text);
    }
    return line.text.startsWith(prefix);
  });

  if (allHave) {
    // Remove prefix from all lines
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
    // Apply prefix to all lines
    let num = 1;
    for (const line of lines) {
      // Remove exclusive prefixes first
      let removeLen = 0;
      if (options.exclusive) {
        for (const excl of options.exclusive) {
          if (line.text.startsWith(excl)) {
            removeLen = excl.length;
            break;
          }
        }
      }
      // Also remove existing numbered prefix if switching to non-numbered
      if (!options.numbered && /^\d+\.\s/.test(line.text)) {
        const m = line.text.match(/^\d+\.\s/);
        if (m) removeLen = m[0].length;
      }
      // Remove existing prefix of same type if partially applied
      if (!options.numbered && line.text.startsWith(prefix)) {
        // Already has prefix — will be added back, so skip
        continue;
      }

      const insertText = options.numbered ? `${num++}. ` : prefix;
      changes.push({ from: line.from, to: line.from + removeLen, insert: insertText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  return true;
}

// ─── Block Insert ────────────────────────────────────────────────────

/**
 * Insert a block template at the cursor position.
 * If template is a function, it receives the selected text as argument.
 * Ensures blank lines before and after the block.
 */
export function insertBlock(view, template) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const selText = state.sliceDoc(from, to);

  const block = typeof template === "function" ? template(selText) : template;

  // Check if we need blank lines before/after
  const lineObj = state.doc.lineAt(from);
  const prevLine = lineObj.number > 1 ? state.doc.line(lineObj.number - 1) : null;
  const needBlankBefore = prevLine && prevLine.text.trim() !== "" && from === lineObj.from;
  const prefix = needBlankBefore ? "\n" : "";

  // Check line after insertion point
  const endLineObj = state.doc.lineAt(to);
  const nextLine = endLineObj.number < state.doc.lines ? state.doc.line(endLineObj.number + 1) : null;
  const needBlankAfter = nextLine && nextLine.text.trim() !== "" && to === endLineObj.to;
  const suffix = needBlankAfter ? "\n" : "";

  const insertText = prefix + block + suffix;

  view.dispatch({
    changes: { from, to, insert: insertText },
    selection: { anchor: from + insertText.length },
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

export function insertEscape(view) {
  const { state } = view;
  const from = state.selection.main.from;
  const to = state.selection.main.to;

  if (from !== to) {
    // Escape each special char in selection
    const selText = state.sliceDoc(from, to);
    const escaped = selText.replace(/([\\`*_{}\[\]()#+\-.!|~>])/g, "\\$1");
    view.dispatch({
      changes: { from, to, insert: escaped },
    });
  } else {
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
    for (const line of lines) {
      const m = line.text.match(/^- \[[ x]\] /);
      if (m) {
        changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
      }
    }
  } else {
    for (const line of lines) {
      // Remove existing list markers first
      let removeLen = 0;
      if (/^- \[[ x]\] /.test(line.text)) {
        continue; // Already task list
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
    view.dispatch({ changes });
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
        sel ? "```\n" + sel + "\n```" : "```\n\n```"
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
        "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| cell | cell | cell |"
      ),
    icon: "\u25A6",
    i18nKey: "format.table",
    group: "block",
  },
  {
    id: "horizontalRule",
    fn: (view) => insertBlock(view, "---"),
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
          `<details>\n<summary>Summary</summary>\n\n${sel || "Content"}\n\n</details>`
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
          ? `${sel}\n: Definition`
          : "Term\n: Definition"
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
