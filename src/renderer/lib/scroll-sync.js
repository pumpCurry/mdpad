/**
 * Scroll synchronization between editor and preview panes.
 * Uses data-source-line attributes for accurate mapping.
 */

let syncing = false;

export function syncEditorToPreview(editorView, previewEl) {
  if (syncing) return;
  syncing = true;

  try {
    const scrollInfo = editorView.scrollDOM;
    const scrollTop = scrollInfo.scrollTop;
    const scrollHeight = scrollInfo.scrollHeight;
    const clientHeight = scrollInfo.clientHeight;

    if (scrollHeight <= clientHeight) {
      syncing = false;
      return;
    }

    // Find the top visible line in editor
    const topPos = editorView.lineBlockAtHeight(scrollTop);
    const topLine = editorView.state.doc.lineAt(topPos.from).number;

    // Find corresponding element in preview by data-source-line
    const elements = previewEl.querySelectorAll("[data-source-line]");
    if (elements.length === 0) {
      // Fallback: proportional scroll
      const ratio = scrollTop / (scrollHeight - clientHeight);
      previewEl.scrollTop =
        ratio * (previewEl.scrollHeight - previewEl.clientHeight);
      syncing = false;
      return;
    }

    // Find the two elements bracketing the current line
    let before = null;
    let after = null;
    for (const el of elements) {
      const line = parseInt(el.getAttribute("data-source-line"), 10);
      if (line <= topLine) {
        before = { el, line };
      } else {
        after = { el, line };
        break;
      }
    }

    if (before && after) {
      // Interpolate position between two mapped elements
      const ratio =
        (topLine - before.line) / (after.line - before.line);
      const beforeTop = before.el.offsetTop;
      const afterTop = after.el.offsetTop;
      previewEl.scrollTop = beforeTop + ratio * (afterTop - beforeTop);
    } else if (before) {
      previewEl.scrollTop = before.el.offsetTop;
    } else if (after) {
      previewEl.scrollTop = 0;
    }
  } finally {
    syncing = false;
  }
}

export function syncPreviewToEditor(previewEl, editorView) {
  if (syncing) return;
  syncing = true;

  try {
    const scrollTop = previewEl.scrollTop;
    const scrollHeight = previewEl.scrollHeight;
    const clientHeight = previewEl.clientHeight;

    if (scrollHeight <= clientHeight) {
      syncing = false;
      return;
    }

    // Proportional fallback
    const ratio = scrollTop / (scrollHeight - clientHeight);
    const editorScrollHeight =
      editorView.scrollDOM.scrollHeight - editorView.scrollDOM.clientHeight;
    editorView.scrollDOM.scrollTop = ratio * editorScrollHeight;
  } finally {
    syncing = false;
  }
}
