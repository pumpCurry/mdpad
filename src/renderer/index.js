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
import { initGlobalSearch, triggerGlobalSearchUpdate } from "./components/global-search.js";
import { syncEditorToPreview } from "./lib/scroll-sync.js";
import { initI18n, t, setLocale, onLocaleChange } from "../i18n/i18n-renderer.js";

// Application state
let currentFilePath = null;
let originalContent = "";
let isDirty = false;

// Session auto-save interval (ms) — lightweight, always on
const SESSION_SAVE_INTERVAL = 5000;

// Autosave (backup) state
let autosaveMinutes = 0; // 0 = OFF
let autosaveTimer = null;

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
    // Also refresh global search for diff pane changes
    triggerGlobalSearchUpdate();
  };

  // Menu action handler
  window.mdpad.onMenuAction((action) => {
    handleMenuAction(action);
  });

  // Expose close-state getter for main process (via executeJavaScript)
  window.__mdpadGetCloseState = () => ({
    isDirty,
    hasFilePath: !!currentFilePath,
    filePath: currentFilePath,
  });

  // Expose content getter for main process save-on-close
  window.__mdpadGetContent = () => getContent();

  // Session auto-save for crash recovery (lightweight, always on)
  setInterval(() => {
    if (isDirty) {
      saveSessionState();
    }
  }, SESSION_SAVE_INTERVAL);

  // Initialize autosave (backup) timer
  autosaveMinutes = await window.mdpad.getAutosaveMinutes();
  startAutosaveTimer();

  // Check for crash recovery: sessions first, then autosave backups
  await checkRecovery();

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

  // Trigger global search update (event-based, not polling)
  triggerGlobalSearchUpdate();
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

  // Handle autosave interval change from menu
  if (action.startsWith("setAutosave:")) {
    const minutes = parseInt(action.split(":")[1], 10);
    autosaveMinutes = minutes;
    await window.mdpad.setAutosaveMinutes(minutes);
    startAutosaveTimer();
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
      alert(`${t("app.version")}\n${t("app.description")}\n\n(C)pumpCurry, 5r4ce2 ${new Date().getFullYear()}`);
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
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

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
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

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
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();
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
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();
  return true;
}

// --- Session management for crash recovery ---

function saveSessionState() {
  try {
    window.mdpad.saveSession({
      content: getContent(),
      filePath: currentFilePath,
      isDirty,
      timestamp: Date.now(),
    });
  } catch {
    // Ignore
  }
}

// --- Autosave (backup) ---

function startAutosaveTimer() {
  // Clear existing timer
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }

  if (autosaveMinutes <= 0) return; // OFF

  const intervalMs = autosaveMinutes * 60 * 1000;
  autosaveTimer = setInterval(() => {
    if (isDirty) {
      performAutosaveBackup();
    }
  }, intervalMs);
}

function performAutosaveBackup() {
  try {
    window.mdpad.saveAutosaveBackup({
      content: getContent(),
      filePath: currentFilePath,
      originalContent: originalContent,
      isDirty,
      timestamp: Date.now(),
    });
  } catch {
    // Ignore
  }
}

// --- Recovery: check for orphaned sessions and autosave backups ---

async function checkRecovery() {
  try {
    // 1. Check session files (lightweight crash recovery)
    const sessions = await window.mdpad.getRecoverySessions();

    // 2. Check autosave backups (more comprehensive, includes originalContent)
    const autosaves = await window.mdpad.getOrphanedAutosaves();

    // Merge: prefer autosave backup (has originalContent for diff), fall back to session
    const allRecoveries = [];

    if (autosaves && autosaves.length > 0) {
      for (const backup of autosaves) {
        allRecoveries.push({
          ...backup,
          source: "autosave",
        });
      }
    }

    if (sessions && sessions.length > 0) {
      for (const session of sessions) {
        // Don't add if we already have an autosave for the same file
        const alreadyHas = allRecoveries.some(
          (r) => r.filePath && r.filePath === session.filePath
        );
        if (!alreadyHas) {
          allRecoveries.push({
            ...session,
            source: "session",
          });
        }
      }
    }

    if (allRecoveries.length === 0) return;

    // Recover the most recent one
    const latest = allRecoveries.sort(
      (a, b) => (b.savedAt || 0) - (a.savedAt || 0)
    )[0];
    if (!latest || !latest.content) return;

    const fileName = latest.filePath
      ? latest.filePath.split(/[\\/]/).pop()
      : t("app.untitled");

    // Ask user if they want to recover
    const recover = confirm(
      `${t("app.name")}: ${fileName}\n\n` +
        (latest.filePath
          ? `${t("dialog.recoveryMessageFile")} ${fileName}`
          : t("dialog.recoveryMessageNew"))
    );

    if (recover) {
      if (latest.filePath) {
        currentFilePath = latest.filePath;
      }
      setContent(latest.content);

      // Restore original content for diff:
      // prefer autosave's stored originalContent, then try loading from file
      if (latest.source === "autosave" && latest.originalContent) {
        originalContent = latest.originalContent;
        setOriginalContent(latest.originalContent);
      } else if (latest.filePath) {
        try {
          const orig = await window.mdpad.openFileByPath(latest.filePath);
          if (orig) {
            originalContent = orig.content;
            setOriginalContent(orig.content);
          }
        } catch {
          // Ignore
        }
      }

      isDirty = true;
      updateTitle();
      const state = getPaneState();
      if (state.preview) updatePreviewImmediate(latest.content);
      if (state.diff) updateDiff(latest.content, originalContent);
    }

    // Clean up all orphaned files
    if (autosaves) {
      for (const backup of autosaves) {
        if (backup._backupFile) {
          await window.mdpad.removeOrphanedBackup(backup._backupFile);
        }
      }
    }
    if (sessions) {
      // Sessions are cleaned via session:clear, but orphaned ones need explicit cleanup
      // The main process already handles this in loadRecoverySessions
    }
  } catch {
    // Ignore recovery errors
  }
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
