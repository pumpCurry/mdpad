import {
  createEditor,
  getContent,
  setContent,
  toggleWordWrap,
  toggleCloseBrackets,
  openSearch,
  focus,
  getEditor,
} from "./components/editor-pane.js";
import { initPreview, updatePreview, updatePreviewImmediate, setOriginalContent } from "./components/preview-pane.js";
import { initDiff, updateDiff } from "./components/diff-pane.js";
import {
  initPaneManager,
  togglePane,
  setPaneState,
  getPaneState,
  onPaneChange,
} from "./components/pane-manager.js";
import { initToolbar, updateButtonStates } from "./components/toolbar.js";
import { initStatusBar, updateStatusBar } from "./components/status-bar.js";
import { initGlobalSearch } from "./components/global-search.js";
import { syncEditorToPreview } from "./lib/scroll-sync.js";
import { initI18n, t, setLocale, onLocaleChange } from "../i18n/i18n-renderer.js";

// Application state
let currentFilePath = null;
let originalContent = "";
let isDirty = false;

// Initialize components
async function init() {
  // Get locale from main process and initialize i18n
  const locale = await window.mdpad.getLocale();
  initI18n(locale);

  // Re-update title when locale changes
  onLocaleChange(() => updateTitle());

  // Init toolbar
  initToolbar();

  // Init editor
  const editorContainer = document.getElementById("editor-pane");
  createEditor(editorContainer, onEditorChange);

  // Init preview
  const previewContainer = document.getElementById("preview-pane");
  initPreview(previewContainer);

  // Init diff
  const diffContainer = document.getElementById("diff-pane");
  initDiff(diffContainer);

  // Init pane manager
  initPaneManager();

  // When any pane becomes visible, immediately sync its content
  onPaneChange((state) => {
    if (state.preview) {
      updatePreviewImmediate(getContent());
    }
    if (state.diff) {
      updateDiff(getContent(), originalContent);
    }
    updateButtonStates();
  });

  // Init status bar
  initStatusBar();

  // Init global search bar
  initGlobalSearch();

  // Set up scroll sync
  const editor = getEditor();
  if (editor) {
    editor.scrollDOM.addEventListener("scroll", () => {
      const state = getPaneState();
      if (state.preview) {
        syncEditorToPreview(editor, document.getElementById("preview-pane"));
      }
    });
  }

  // Editor cursor/selection update for status bar
  const editorView = getEditor();
  if (editorView) {
    setInterval(updateStatusBar, 200);
  }

  // Diff update function (called from diff-pane when mode changes)
  window._mdpadDiffUpdate = () => {
    const state = getPaneState();
    if (state.diff) {
      updateDiff(getContent(), originalContent);
    }
  };

  // Menu action handler
  window.mdpad.onMenuAction((action) => {
    handleMenuAction(action);
  });

  // Update title
  updateTitle();

  // Focus editor
  focus();
}

function onEditorChange(content) {
  isDirty = true;
  updateTitle();

  const state = getPaneState();

  // Update preview if visible
  if (state.preview) {
    updatePreview(content);
  }

  // Update diff if visible
  if (state.diff) {
    updateDiff(content, originalContent);
  }

  updateStatusBar();
}

function updateTitle() {
  const fileName = currentFilePath
    ? currentFilePath.split(/[\\/]/).pop()
    : t("app.untitled");
  const dirtyMark = isDirty ? "* " : "";
  window.mdpad.setTitle(`${dirtyMark}${fileName} - mdpad`);
}

async function handleMenuAction(action) {
  // Handle locale change from menu
  if (action.startsWith("changeLocale:")) {
    const newLocale = action.split(":")[1];
    setLocale(newLocale);
    // Also persist on main process side (already done via menu click)
    await window.mdpad.setLocale(newLocale);
    return;
  }

  switch (action) {
    case "new":
      await newFile();
      break;
    case "open":
      await openFile();
      break;
    case "save":
      await saveFile();
      break;
    case "saveAs":
      await saveFileAs();
      break;
    case "find":
      openSearch();
      break;
    case "replace":
      openSearch();
      break;
    case "toggleEditor":
      togglePane("editor");
      break;
    case "togglePreview":
      togglePane("preview");
      break;
    case "toggleDiff":
      togglePane("diff");
      break;
    case "toggleWordWrap":
      toggleWordWrap();
      break;
    case "toggleCloseBrackets":
      toggleCloseBrackets();
      break;
    case "undo":
      {
        const editor = getEditor();
        if (editor) {
          import("@codemirror/commands").then(({ undo }) => {
            undo(editor);
          });
        }
      }
      break;
    case "redo":
      {
        const editor = getEditor();
        if (editor) {
          import("@codemirror/commands").then(({ redo }) => {
            redo(editor);
          });
        }
      }
      break;
    case "about":
      alert(`${t("app.version")}\n${t("app.description")}\n\n(C)5r4ce2`);
      break;
  }
}

async function newFile() {
  if (isDirty) {
    const result = await window.mdpad.confirmSave();
    if (result === 0) {
      const saved = await saveFile();
      if (!saved) return;
    } else if (result === 2) {
      return;
    }
  }
  currentFilePath = null;
  originalContent = "";
  isDirty = false;
  setContent("");
  setOriginalContent("");
  updateTitle();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate("");
  if (state.diff) updateDiff("", "");
}

async function openFile() {
  if (isDirty) {
    const result = await window.mdpad.confirmSave();
    if (result === 0) {
      const saved = await saveFile();
      if (!saved) return;
    } else if (result === 2) {
      return;
    }
  }

  const result = await window.mdpad.openFile();
  if (!result) return;

  currentFilePath = result.path;
  originalContent = result.content;
  isDirty = false;
  setContent(result.content);
  setOriginalContent(result.content);
  updateTitle();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(result.content);
  if (state.diff) updateDiff(result.content, originalContent);
}

async function saveFile() {
  if (!currentFilePath) {
    return await saveFileAs();
  }
  const content = getContent();
  await window.mdpad.saveFile(currentFilePath, content);
  originalContent = content;
  setOriginalContent(content);
  isDirty = false;
  updateTitle();
  return true;
}

async function saveFileAs() {
  const content = getContent();
  const result = await window.mdpad.saveFileAs(content);
  if (!result) return false;
  currentFilePath = result.path;
  originalContent = content;
  setOriginalContent(content);
  isDirty = false;
  updateTitle();
  return true;
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
