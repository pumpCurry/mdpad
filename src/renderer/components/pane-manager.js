import { refreshLayout as refreshEditor } from "./editor-pane.js";

let paneState = {
  editor: true,
  preview: false,
  diff: false,
};

let elements = {};
let onPaneChangeCallback = null;

export function onPaneChange(callback) {
  onPaneChangeCallback = callback;
}

export function initPaneManager() {
  elements = {
    editor: document.getElementById("editor-pane"),
    preview: document.getElementById("preview-pane"),
    diff: document.getElementById("diff-pane"),
    handle1: document.getElementById("resize-handle-1"),
    handle2: document.getElementById("resize-handle-2"),
    container: document.getElementById("pane-container"),
  };

  // Set up resize handles
  setupResizeHandle(elements.handle1, "editor", "preview");
  setupResizeHandle(elements.handle2, "preview", "diff");

  applyLayout();
}

export function togglePane(name) {
  if (!paneState.hasOwnProperty(name)) return;

  // Don't allow hiding all panes
  const newState = !paneState[name];
  const otherPanesVisible = Object.entries(paneState)
    .filter(([k]) => k !== name)
    .some(([, v]) => v);

  if (!newState && !otherPanesVisible) return; // At least one pane must be visible

  paneState[name] = newState;
  applyLayout();
  if (onPaneChangeCallback) onPaneChangeCallback({ ...paneState });
}

export function setPaneState(state) {
  paneState = { ...paneState, ...state };
  applyLayout();
  if (onPaneChangeCallback) onPaneChangeCallback({ ...paneState });
}

export function getPaneState() {
  return { ...paneState };
}

function applyLayout() {
  const visiblePanes = [];

  // Determine visibility
  for (const [name, visible] of Object.entries(paneState)) {
    const el = elements[name];
    if (!el) continue;
    if (visible) {
      el.style.display = "flex";
      visiblePanes.push(name);
    } else {
      el.style.display = "none";
    }
  }

  // Reset flex values
  for (const name of ["editor", "preview", "diff"]) {
    const el = elements[name];
    if (el) {
      el.style.flex = paneState[name] ? "1 1 0" : "";
    }
  }

  // Resize handles: show between adjacent visible panes
  const handle1Visible = paneState.editor && paneState.preview;
  const handle2Visible =
    (paneState.preview && paneState.diff) ||
    (paneState.editor && paneState.diff && !paneState.preview);

  elements.handle1.style.display = handle1Visible ? "block" : "none";
  elements.handle2.style.display = handle2Visible ? "block" : "none";

  // If editor and diff are visible but preview is not, handle2 should be between them
  // Reorder DOM if needed
  const container = elements.container;
  if (paneState.editor && paneState.diff && !paneState.preview) {
    // Ensure order: editor, handle2, diff
    container.appendChild(elements.editor);
    container.appendChild(elements.handle2);
    container.appendChild(elements.diff);
  } else {
    // Normal order: editor, handle1, preview, handle2, diff
    container.appendChild(elements.editor);
    container.appendChild(elements.handle1);
    container.appendChild(elements.preview);
    container.appendChild(elements.handle2);
    container.appendChild(elements.diff);
  }

  // Refresh CodeMirror layout after pane changes
  requestAnimationFrame(() => {
    refreshEditor();
  });
}

function setupResizeHandle(handle, leftPane, rightPane) {
  let startX = 0;
  let startLeftWidth = 0;
  let startRightWidth = 0;

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.classList.add("active");
    handle.setPointerCapture(e.pointerId);

    startX = e.clientX;
    startLeftWidth = elements[leftPane].offsetWidth;
    startRightWidth = elements[rightPane].offsetWidth;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const newLeftWidth = Math.max(100, startLeftWidth + dx);
      const newRightWidth = Math.max(100, startRightWidth - dx);

      elements[leftPane].style.flex = `0 0 ${newLeftWidth}px`;
      elements[rightPane].style.flex = `0 0 ${newRightWidth}px`;

      refreshEditor();
    };

    const onUp = (e) => {
      handle.classList.remove("active");
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      refreshEditor();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}
