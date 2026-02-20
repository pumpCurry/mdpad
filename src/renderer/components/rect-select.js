/**
 * Rectangular selection cut/copy/paste extension for CodeMirror 6.
 *
 * Enhances the built-in rectangularSelection() with:
 * - Copy: extracts rectangular text block (one string per selected line)
 * - Cut: copies then removes selected chars (preserves newlines)
 * - Paste: inserts clipboard lines at cursor column on successive lines,
 *   padding short lines with spaces as needed
 */

import { EditorView } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

// StateEffect to mark/clear rectangular clipboard
const setRectClipboard = StateEffect.define();

// StateField tracking whether the last copy/cut was rectangular
const rectClipboardField = StateField.define({
  create() {
    return { isRect: false, lines: [] };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRectClipboard)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Detect if the current selection is "rectangular" (multi-cursor from Alt+drag).
 * A selection is rectangular if there are >= 2 ranges on consecutive lines.
 */
function isRectangularSelection(state) {
  const sel = state.selection;
  if (sel.ranges.length < 2) return false;

  const lineNums = sel.ranges.map((r) => state.doc.lineAt(r.from).number);
  lineNums.sort((a, b) => a - b);

  for (let i = 1; i < lineNums.length; i++) {
    if (lineNums[i] !== lineNums[i - 1] + 1) return false;
  }
  return true;
}

/**
 * Extract rectangular text block from current multi-cursor selection.
 * Returns array of strings, one per selected line.
 */
function extractRectText(state) {
  const ranges = [...state.selection.ranges];
  ranges.sort((a, b) => a.from - b.from);
  return ranges.map((r) => state.sliceDoc(r.from, r.to));
}

/**
 * Custom copy handler for rectangular selection.
 */
function rectCopy(view) {
  const state = view.state;
  if (!isRectangularSelection(state)) return false;

  const lines = extractRectText(state);
  const text = lines.join("\n");

  navigator.clipboard.writeText(text).catch(() => {});

  view.dispatch({
    effects: setRectClipboard.of({ isRect: true, lines }),
  });

  return true;
}

/**
 * Custom cut handler for rectangular selection.
 */
function rectCut(view) {
  const state = view.state;
  if (!isRectangularSelection(state)) return false;

  const lines = extractRectText(state);
  const text = lines.join("\n");

  navigator.clipboard.writeText(text).catch(() => {});

  view.dispatch({
    effects: setRectClipboard.of({ isRect: true, lines }),
  });

  // Delete selected ranges (each range is on its own line, no overlap)
  const ranges = [...state.selection.ranges];
  ranges.sort((a, b) => a.from - b.from);
  const changes = ranges.map((r) => ({
    from: r.from,
    to: r.to,
    insert: "",
  }));

  view.dispatch({ changes });

  return true;
}

/**
 * Custom paste handler for rectangular clipboard.
 * Pastes each clipboard line at the cursor column on successive editor lines.
 */
function rectPaste(view) {
  const rectState = view.state.field(rectClipboardField);
  if (!rectState.isRect || rectState.lines.length === 0) return false;

  const state = view.state;
  const sel = state.selection;
  const clipLines = rectState.lines;

  // If there's an active rectangular selection with matching line count, replace range-by-range
  if (isRectangularSelection(state) && sel.ranges.length === clipLines.length) {
    const ranges = [...sel.ranges];
    ranges.sort((a, b) => a.from - b.from);
    const changes = ranges.map((r, i) => ({
      from: r.from,
      to: r.to,
      insert: clipLines[i] || "",
    }));
    view.dispatch({ changes });
    return true;
  }

  // If there's an active rectangular selection with different line count, delete first then paste
  if (isRectangularSelection(state)) {
    const ranges = [...sel.ranges];
    ranges.sort((a, b) => a.from - b.from);
    // Get the cursor column from the first range
    const firstLine = state.doc.lineAt(ranges[0].from);
    const curCol = ranges[0].from - firstLine.from;
    const startLineNum = firstLine.number;

    // Delete existing selection
    const deleteChanges = ranges.map((r) => ({
      from: r.from,
      to: r.to,
      insert: "",
    }));
    view.dispatch({ changes: deleteChanges });

    // Now paste at the same column positions (use fresh state after deletion)
    pasteAtColumn(view, startLineNum, curCol, clipLines);
    return true;
  }

  // Single cursor: paste rectangular block starting at cursor line/column
  if (sel.ranges.length === 1) {
    const pos = sel.main.head;
    const curLine = state.doc.lineAt(pos);
    const curCol = pos - curLine.from;
    const startLineNum = curLine.number;

    pasteAtColumn(view, startLineNum, curCol, clipLines);
    return true;
  }

  return false;
}

/**
 * Paste clipboard lines at a given column on successive lines.
 * Pads short lines with spaces if needed. Appends new lines if doc is shorter.
 */
function pasteAtColumn(view, startLineNum, curCol, clipLines) {
  const state = view.state;
  const changes = [];

  for (let i = 0; i < clipLines.length; i++) {
    const targetLineNum = startLineNum + i;

    if (targetLineNum > state.doc.lines) {
      // Beyond document end: append new line with padding
      const lastLine = state.doc.line(state.doc.lines);
      const padding = " ".repeat(curCol);
      changes.push({
        from: lastLine.to,
        to: lastLine.to,
        insert: "\n" + padding + clipLines[i],
      });
    } else {
      const targetLine = state.doc.line(targetLineNum);
      const lineLen = targetLine.to - targetLine.from;

      if (lineLen < curCol) {
        // Line is shorter than cursor column: pad with spaces
        const padding = " ".repeat(curCol - lineLen);
        changes.push({
          from: targetLine.to,
          to: targetLine.to,
          insert: padding + clipLines[i],
        });
      } else {
        // Insert at cursor column
        const insertPos = targetLine.from + curCol;
        changes.push({
          from: insertPos,
          to: insertPos,
          insert: clipLines[i],
        });
      }
    }
  }

  view.dispatch({ changes });
}

/**
 * Build the extension for rectangular selection clipboard support.
 * Returns an array of extensions to spread into the editor config.
 */
export function rectSelectExtension() {
  return [
    rectClipboardField,
    EditorView.domEventHandlers({
      copy(event, view) {
        if (rectCopy(view)) {
          event.preventDefault();
          return true;
        }
        // Normal copy: clear rectangular clipboard flag
        view.dispatch({
          effects: setRectClipboard.of({ isRect: false, lines: [] }),
        });
        return false;
      },
      cut(event, view) {
        if (rectCut(view)) {
          event.preventDefault();
          return true;
        }
        // Normal cut: clear rectangular clipboard flag
        view.dispatch({
          effects: setRectClipboard.of({ isRect: false, lines: [] }),
        });
        return false;
      },
      paste(event, view) {
        if (rectPaste(view)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
  ];
}
