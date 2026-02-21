import {
  createEditor,
  getContent,
  setContent,
  clearHistory,
  toggleWordWrap,
  toggleCloseBrackets,
  openSearch,
  focus,
  getEditor,
  goToLine,
  getCursorInfo,
} from "./components/editor-pane.js";
import { initPreview, updatePreview, updatePreviewImmediate, setOriginalContent, setPreviewBaseDir } from "./components/preview-pane.js";
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
import { initGlobalSearch, triggerGlobalSearchUpdate, isDndInsertMode } from "./components/global-search.js";
import { syncEditorToPreview } from "./lib/scroll-sync.js";
import { initI18n, t, setLocale, onLocaleChange } from "../i18n/i18n-renderer.js";

// Application state
let currentFilePath = null;
let originalContent = "";
let isDirty = false;
let suppressDirty = false; // Suppress isDirty changes during programmatic setContent

// Session auto-save interval (ms) — lightweight, always on
const SESSION_SAVE_INTERVAL = 5000;

// Autosave (backup) state
let autosaveMinutes = 0; // 0 = OFF
let autosaveTimer = null;
let autosaveNextAt = 0; // timestamp (ms) of next autosave, 0 = not scheduled

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
        syncEditorToPreview(editor, document.querySelector("#preview-pane .preview-content"));
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

  // Status bar click → Go to Line
  window.addEventListener("mdpad:goToLine", () => showGoToLineDialog());

  // Expose close-state getter for main process (via executeJavaScript)
  window.__mdpadGetCloseState = () => ({
    isDirty,
    hasFilePath: !!currentFilePath,
    filePath: currentFilePath,
  });

  // Expose content getter for main process save-on-close
  window.__mdpadGetContent = () => getContent();

  // Expose editor view for smoke tests
  window.__mdpadEditor = () => getEditor();

  // Close dialog listener (main → renderer)
  window.mdpad.onShowCloseDialog((closeState) => {
    showCloseDialog(closeState);
  });

  // Expose showCloseDialog for smoke tests
  window.__mdpadShowCloseDialog = (closeState) => {
    showCloseDialog(closeState || {
      isDirty: true,
      hasFilePath: !!currentFilePath,
      filePath: currentFilePath,
    });
  };

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

  // Set up drag-and-drop
  initDragAndDrop();

  // Intercept ALL link clicks — the app's HTML must never be replaced.
  // http/https → open in external browser
  // #anchor within preview/diff → scroll within pane (safe, no navigation)
  // everything else → block silently
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    // #anchor links inside preview/diff panes → allow in-pane scroll
    if (href.startsWith("#")) {
      const previewPane = link.closest("#preview-pane, #diff-pane");
      if (previewPane) {
        e.preventDefault();
        e.stopPropagation();
        // Find the target element by id within the pane
        const targetId = CSS.escape(href.slice(1));
        const target = previewPane.querySelector(`[id="${targetId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
    }

    // Always prevent default navigation for any link
    e.preventDefault();
    e.stopPropagation();

    // Open http/https links in external browser
    if (/^https?:\/\//i.test(href)) {
      window.mdpad.openExternal(href);
    }
    // All other links (file://, relative paths, etc.) are silently blocked
  });

  // Focus editor
  focus();
}

function onEditorChange(content) {
  if (suppressDirty) return; // Ignore changes during programmatic setContent
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

/**
 * Set editor content without triggering isDirty.
 * Also resets undo history so Ctrl+Z can't revert past this point.
 */
function setContentClean(text) {
  suppressDirty = true;
  setContent(text);
  clearHistory();
  suppressDirty = false;
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

  // Handle file opened in new window via drag-drop
  if (action.startsWith("dropOpenFile:")) {
    const filePath = action.substring("dropOpenFile:".length);
    await loadFileByPath(filePath);
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
    case "goToLine":
      showGoToLineDialog();
      break;
    case "newWindow":
      window.mdpad.newWindow();
      break;
    case "restoreBackup":
      showRestoreFromBackupMenu();
      break;
    case "about":
      showAboutDialog();
      break;
  }
}

function showGoToLineDialog() {
  // Prevent duplicate dialogs
  if (document.getElementById("goto-line-overlay")) return;

  const info = getCursorInfo();
  const totalLines = info.totalLines || 0;

  // Create overlay
  const overlay = document.createElement("div");
  overlay.id = "goto-line-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.3);z-index:9999;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:20vh;";

  // Create dialog box
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
    "padding:16px;width:300px;box-shadow:0 8px 24px rgba(0,0,0,0.15);";

  const titleEl = document.createElement("div");
  titleEl.textContent = t("goToLine.title");
  titleEl.style.cssText = "font-size:14px;font-weight:600;margin-bottom:8px;color:#24292f;";

  const input = document.createElement("input");
  input.type = "number";
  input.min = 1;
  input.max = totalLines;
  input.placeholder = `${t("goToLine.placeholder")} (1-${totalLines})`;
  input.style.cssText =
    "width:100%;padding:6px 8px;border:1px solid #d0d7de;" +
    "border-radius:4px;font-size:14px;outline:none;box-sizing:border-box;";

  const errorEl = document.createElement("div");
  errorEl.style.cssText = "font-size:12px;color:#cf222e;margin-top:4px;min-height:18px;";

  dialog.appendChild(titleEl);
  dialog.appendChild(input);
  dialog.appendChild(errorEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  input.focus();

  function close() {
    overlay.remove();
    focus();
  }

  function submit() {
    const val = parseInt(input.value, 10);
    if (isNaN(val) || val < 1 || val > totalLines) {
      errorEl.textContent = t("goToLine.outOfRange");
      input.select();
      return;
    }
    goToLine(val);
    close();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
}

async function showAboutDialog() {
  // Prevent duplicate
  if (document.getElementById("about-overlay")) return;

  // Get version info from main process
  let versionStr = "v1.1.00001";
  try {
    const info = await window.mdpad.getVersionInfo();
    versionStr = info.version;
  } catch {
    // Fallback
  }

  const overlay = document.createElement("div");
  overlay.id = "about-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.3);z-index:9999;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

  const dialog = document.createElement("div");
  dialog.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:12px;" +
    "padding:28px 32px;width:360px;box-shadow:0 12px 40px rgba(0,0,0,0.18);text-align:center;";

  // App icon
  const iconEl = document.createElement("img");
  iconEl.src = "../../dist/renderer/icon.png";
  iconEl.alt = "mdpad";
  iconEl.style.cssText =
    "width:72px;height:72px;border-radius:14px;margin-bottom:12px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.12);";
  iconEl.onerror = () => { iconEl.style.display = "none"; };
  dialog.appendChild(iconEl);

  // App name
  const nameEl = document.createElement("div");
  nameEl.textContent = "mdpad";
  nameEl.style.cssText =
    "font-size:22px;font-weight:700;color:#24292f;margin-bottom:2px;" +
    "letter-spacing:0.5px;";
  dialog.appendChild(nameEl);

  // Version
  const verEl = document.createElement("div");
  verEl.textContent = versionStr;
  verEl.style.cssText =
    "font-size:13px;color:#8b949e;margin-bottom:10px;" +
    "font-family:'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;";
  dialog.appendChild(verEl);

  // Description
  const descEl = document.createElement("div");
  descEl.textContent = t("app.description");
  descEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:10px;line-height:1.4;";
  dialog.appendChild(descEl);

  // Copyright
  const copyrightEl = document.createElement("div");
  copyrightEl.textContent = `(C) pumpCurry, 5r4ce2 ${new Date().getFullYear()}`;
  copyrightEl.style.cssText = "font-size:12px;color:#8b949e;margin-bottom:14px;";
  dialog.appendChild(copyrightEl);

  // Links section
  const linksEl = document.createElement("div");
  linksEl.style.cssText =
    "border-top:1px solid #d8dee4;padding-top:12px;margin-bottom:16px;" +
    "display:flex;flex-direction:column;gap:6px;";

  const supportLink = document.createElement("div");
  supportLink.style.cssText = "font-size:12px;color:#57606a;display:flex;align-items:center;justify-content:center;gap:6px;";
  const supportLabel = document.createElement("span");
  supportLabel.textContent = t("app.support") + ":";
  const supportA = document.createElement("a");
  supportA.textContent = "github.com/pumpCurry/mdpad";
  supportA.href = "#";
  supportA.style.cssText = "color:#0969da;text-decoration:none;cursor:pointer;";
  supportA.onclick = (e) => { e.preventDefault(); window.mdpad.openExternal("https://github.com/pumpCurry/mdpad"); };
  supportA.onmouseover = () => { supportA.style.textDecoration = "underline"; };
  supportA.onmouseout = () => { supportA.style.textDecoration = "none"; };
  supportLink.appendChild(supportLabel);
  supportLink.appendChild(supportA);
  linksEl.appendChild(supportLink);

  const devLink = document.createElement("div");
  devLink.style.cssText = "font-size:12px;color:#57606a;display:flex;align-items:center;justify-content:center;gap:6px;";
  const devLabel = document.createElement("span");
  devLabel.textContent = t("app.devSite") + ":";
  const devA = document.createElement("a");
  devA.textContent = "542.jp";
  devA.href = "#";
  devA.style.cssText = "color:#0969da;text-decoration:none;cursor:pointer;";
  devA.onclick = (e) => { e.preventDefault(); window.mdpad.openExternal("https://542.jp/"); };
  devA.onmouseover = () => { devA.style.textDecoration = "underline"; };
  devA.onmouseout = () => { devA.style.textDecoration = "none"; };
  devLink.appendChild(devLabel);
  devLink.appendChild(devA);
  linksEl.appendChild(devLink);

  dialog.appendChild(linksEl);

  // OK button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "OK";
  closeBtn.style.cssText =
    "padding:6px 32px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;color:#24292f;" +
    "transition:background 0.15s;";
  closeBtn.onmouseover = () => { closeBtn.style.background = "#e8ebef"; };
  closeBtn.onmouseout = () => { closeBtn.style.background = "#f6f8fa"; };
  closeBtn.onclick = () => { overlay.remove(); focus(); };
  dialog.appendChild(closeBtn);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  closeBtn.focus();

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      overlay.remove();
      focus();
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) { overlay.remove(); focus(); }
  });
}

/**
 * Show HTML confirmation dialog before discarding unsaved changes.
 * Replaces native dialog.showMessageBox().
 * Returns: "save" | "dontSave" | "cancel"
 */
function showConfirmSaveDialog() {
  return new Promise((resolve) => {
    // Prevent duplicate
    if (document.getElementById("confirm-save-overlay")) {
      resolve("cancel");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "confirm-save-overlay";
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,0.4);z-index:10000;" +
      "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

    const modal = document.createElement("div");
    modal.style.cssText =
      "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
      "padding:20px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.2);";

    // Title row with × button
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;";

    const titleEl = document.createElement("div");
    titleEl.textContent = t("dialog.saveConfirmMessage");
    titleEl.style.cssText = "font-size:16px;font-weight:700;color:#24292f;";
    titleRow.appendChild(titleEl);

    const closeXBtn = document.createElement("button");
    closeXBtn.textContent = "×";
    closeXBtn.style.cssText =
      "border:none;background:transparent;font-size:20px;color:#57606a;" +
      "cursor:pointer;padding:0 4px;line-height:1;";
    closeXBtn.onclick = () => done("cancel");
    titleRow.appendChild(closeXBtn);
    modal.appendChild(titleRow);

    // Detail message
    const msgEl = document.createElement("div");
    msgEl.textContent = t("dialog.saveConfirmDetail");
    msgEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:16px;line-height:1.5;";
    modal.appendChild(msgEl);

    // Buttons row: [Don't Save] ...space... [Cancel] [Save]
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const dontSaveBtn = document.createElement("button");
    dontSaveBtn.textContent = t("dialog.saveConfirmDontSave");
    dontSaveBtn.style.cssText =
      "padding:6px 16px;border:1px solid #cf222e;border-radius:6px;" +
      "background:#fff;color:#cf222e;cursor:pointer;font-size:13px;" +
      "margin-right:auto;";
    dontSaveBtn.tabIndex = 3;
    dontSaveBtn.onclick = () => done("dontSave");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = t("dialog.saveConfirmCancel");
    cancelBtn.style.cssText =
      "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
      "background:#f6f8fa;cursor:pointer;font-size:13px;";
    cancelBtn.tabIndex = 2;
    cancelBtn.onclick = () => done("cancel");

    const saveBtn = document.createElement("button");
    saveBtn.textContent = t("dialog.saveConfirmTitle");
    saveBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:6px;" +
      "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
    saveBtn.tabIndex = 1;
    saveBtn.onclick = () => done("save");

    btnRow.appendChild(dontSaveBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Keyboard support
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done("cancel");
      }
    });

    // Click overlay background → cancel
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) done("cancel");
    });

    // Focus primary button
    saveBtn.focus();

    function done(result) {
      overlay.remove();
      resolve(result);
    }
  });
}

async function newFile() {
  if (isDirty) {
    const result = await showConfirmSaveDialog();
    if (result === "save") {
      const saved = await saveFile();
      if (!saved) return;
    } else if (result === "cancel") {
      return;
    }
    // "dontSave" → proceed without saving
  }
  currentFilePath = null;
  originalContent = "";
  isDirty = false;
  setContentClean("");
  setOriginalContent("");
  setPreviewBaseDir(null);
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate("");
  if (state.diff) updateDiff("", "");
}

async function openFile() {
  if (isDirty) {
    const result = await showConfirmSaveDialog();
    if (result === "save") {
      const saved = await saveFile();
      if (!saved) return;
    } else if (result === "cancel") {
      return;
    }
  }

  const result = await window.mdpad.openFile();
  if (!result) return;

  currentFilePath = result.path;
  originalContent = result.content;
  isDirty = false;
  setContentClean(result.content);
  setOriginalContent(result.content);
  setPreviewBaseDir(result.path);
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
  setPreviewBaseDir(result.path);
  isDirty = false;
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();
  return true;
}

// --- Load file by path (used by drag-drop new window) ---

async function loadFileByPath(filePath) {
  const result = await window.mdpad.openFileByPath(filePath);
  if (!result) return;

  currentFilePath = result.path;
  originalContent = result.content;
  isDirty = false;
  setContentClean(result.content);
  setOriginalContent(result.content);
  setPreviewBaseDir(result.path);
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(result.content);
  if (state.diff) updateDiff(result.content, originalContent);
}

// --- Drag-and-drop ---

function initDragAndDrop() {
  const editorPaneEl = document.getElementById("editor-pane");

  // Prevent default browser drag behavior globally
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const filePath = window.mdpad.getFilePath(file);
    if (!filePath) return;

    // DnD behavior:
    //   Shift+Drop (anywhere): open file in CURRENT window (replace, with confirmation)
    //   DnD Insert Mode ON + drop on editor: insert content at cursor
    //   Default (no modifier, insert mode off): open in NEW process
    if (e.shiftKey) {
      // --- Shift+Drop: replace current document ---
      await openFileInCurrentWindow(filePath);
    } else if (isDndInsertMode() && isInsideEditor(e.target, editorPaneEl)) {
      // --- Insert mode: read file content and insert at drop position ---
      try {
        const text = await readFileAsText(file);
        const editor = getEditor();
        if (editor) {
          const pos = editor.posAtCoords({ x: e.clientX, y: e.clientY });
          const insertPos = pos != null ? pos : editor.state.selection.main.head;
          editor.dispatch({
            changes: { from: insertPos, insert: text },
            selection: { anchor: insertPos + text.length },
          });
          editor.focus();
        }
      } catch {
        // Non-text file — ignore
      }
    } else {
      // --- Default: open in a new process ---
      await window.mdpad.openFileInNewWindow(filePath);
    }
  });
}

/**
 * Open a file in the current window, replacing current content.
 * Shows confirmation if current document has unsaved changes.
 */
async function openFileInCurrentWindow(filePath) {
  if (isDirty) {
    const result = await showConfirmSaveDialog();
    if (result === "save") {
      const saved = await saveFile();
      if (!saved) return;
    } else if (result === "cancel") {
      return;
    }
    // "dontSave" → proceed without saving
  }

  await loadFileByPath(filePath);
}

/**
 * Check if an element is inside the CodeMirror editor DOM
 */
function isInsideEditor(target, editorPaneEl) {
  if (!target || !editorPaneEl) return false;
  // Walk up from the drop target to see if it's inside the editor pane
  let el = target;
  while (el) {
    if (el === editorPaneEl) return true;
    // Also check for CodeMirror's internal classes
    if (el.classList && el.classList.contains("cm-editor")) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Read a File object as UTF-8 text
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
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

  autosaveNextAt = 0;

  if (autosaveMinutes <= 0) return; // OFF

  const intervalMs = autosaveMinutes * 60 * 1000;
  autosaveNextAt = Date.now() + intervalMs;
  autosaveTimer = setInterval(() => {
    if (isDirty) {
      performAutosaveBackup();
    }
    // Reset next-at for the next cycle
    autosaveNextAt = Date.now() + intervalMs;
  }, intervalMs);
}

/** Get autosave info for status bar display (exposed via window). */
window.__mdpadGetAutosaveInfo = function() {
  return { minutes: autosaveMinutes, nextAt: autosaveNextAt };
};

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

async function gatherRecoveries() {
  const sessions = await window.mdpad.getRecoverySessions();
  const autosaves = await window.mdpad.getOrphanedAutosaves();
  const allRecoveries = [];

  if (autosaves && autosaves.length > 0) {
    for (const backup of autosaves) {
      allRecoveries.push({ ...backup, source: "autosave" });
    }
  }

  if (sessions && sessions.length > 0) {
    for (const session of sessions) {
      const alreadyHas = allRecoveries.some(
        (r) => r.filePath && r.filePath === session.filePath
      );
      if (!alreadyHas) {
        allRecoveries.push({ ...session, source: "session" });
      }
    }
  }

  // Sort newest first
  allRecoveries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return { allRecoveries, autosaves, sessions };
}

async function checkRecovery() {
  try {
    const { allRecoveries, autosaves } = await gatherRecoveries();
    if (allRecoveries.length === 0) return;

    // Show the recovery modal (non-blocking, replaces confirm())
    showRecoveryModal(allRecoveries, autosaves);
  } catch {
    // Ignore recovery errors
  }
}

// Called from File menu → "Restore from Backup..."
async function showRestoreFromBackupMenu() {
  try {
    const { allRecoveries, autosaves } = await gatherRecoveries();
    if (allRecoveries.length === 0) {
      showRecoveryModal([], null); // Show "no backups" message
    } else {
      showRecoveryModal(allRecoveries, autosaves);
    }
  } catch {
    // Ignore
  }
}

function showRecoveryModal(recoveries, autosaves) {
  // Prevent duplicate
  if (document.getElementById("recovery-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "recovery-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.4);z-index:9999;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:10vh;";

  const modal = document.createElement("div");
  modal.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
    "padding:20px;width:480px;max-height:70vh;display:flex;flex-direction:column;" +
    "box-shadow:0 8px 24px rgba(0,0,0,0.2);";

  // Title row with × button
  const titleRow = document.createElement("div");
  titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";

  const titleEl = document.createElement("div");
  titleEl.textContent = t("recovery.title");
  titleEl.style.cssText = "font-size:16px;font-weight:700;color:#24292f;";
  titleRow.appendChild(titleEl);

  const closeXBtn = document.createElement("button");
  closeXBtn.textContent = "×";
  closeXBtn.style.cssText =
    "border:none;background:transparent;font-size:20px;color:#57606a;" +
    "cursor:pointer;padding:0 4px;line-height:1;";
  closeXBtn.onclick = () => { overlay.remove(); focus(); };
  titleRow.appendChild(closeXBtn);

  modal.appendChild(titleRow);

  if (recoveries.length === 0) {
    // No backups message
    const noEl = document.createElement("div");
    noEl.textContent = t("recovery.noBackups");
    noEl.style.cssText = "font-size:14px;color:#57606a;padding:16px 0;";
    modal.appendChild(noEl);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = t("recovery.close");
    closeBtn.style.cssText =
      "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
      "background:#f6f8fa;cursor:pointer;font-size:13px;align-self:flex-end;";
    closeBtn.onclick = () => { overlay.remove(); focus(); };
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return;
  }

  // Description
  const descEl = document.createElement("div");
  descEl.textContent = t("recovery.description");
  descEl.style.cssText = "font-size:13px;color:#57606a;margin-bottom:12px;";
  modal.appendChild(descEl);

  // List container
  const listEl = document.createElement("div");
  listEl.style.cssText =
    "flex:1;overflow-y:auto;border:1px solid #d0d7de;border-radius:6px;" +
    "margin-bottom:12px;";

  let selectedIdx = 0;

  function renderList() {
    listEl.innerHTML = "";
    recoveries.forEach((rec, i) => {
      const item = document.createElement("div");
      item.style.cssText =
        "padding:10px 12px;cursor:pointer;border-bottom:1px solid #eaeef2;" +
        "display:flex;flex-direction:column;gap:2px;" +
        (i === selectedIdx ? "background:#ddf4ff;" : "background:#fff;");

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:center;gap:8px;";

      const radio = document.createElement("span");
      radio.textContent = i === selectedIdx ? "●" : "○";
      radio.style.cssText = "color:#0969da;font-size:14px;flex-shrink:0;";
      topRow.appendChild(radio);

      const fileName = rec.filePath
        ? rec.filePath.split(/[\\/]/).pop()
        : t("recovery.untitled");
      const nameEl = document.createElement("span");
      nameEl.textContent = fileName;
      nameEl.style.cssText = "font-weight:600;font-size:14px;color:#24292f;";
      topRow.appendChild(nameEl);

      item.appendChild(topRow);

      const metaRow = document.createElement("div");
      metaRow.style.cssText =
        "font-size:12px;color:#57606a;margin-left:22px;display:flex;gap:12px;";

      const sourceLabel =
        rec.source === "autosave"
          ? t("recovery.source_autosave")
          : t("recovery.source_session");

      const dateStr = rec.savedAt
        ? new Date(rec.savedAt).toLocaleString()
        : "-";

      metaRow.innerHTML =
        `<span>${sourceLabel}</span><span>${dateStr}</span>`;

      // Content preview (first 80 chars)
      if (rec.content) {
        const preview = rec.content.replace(/\n/g, " ").substring(0, 80);
        const previewEl = document.createElement("span");
        previewEl.textContent = preview + (rec.content.length > 80 ? "..." : "");
        previewEl.style.cssText = "color:#8b949e;font-style:italic;";
        metaRow.appendChild(previewEl);
      }

      item.appendChild(metaRow);

      item.onclick = () => {
        selectedIdx = i;
        renderList();
      };
      item.ondblclick = () => {
        selectedIdx = i;
        doRestore();
      };

      listEl.appendChild(item);
    });
  }

  renderList();
  modal.appendChild(listEl);

  // Buttons row: [Delete Selected] ...space... [Later] [Restore Selected]
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;align-items:center;";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = t("recovery.deleteSelected");
  deleteBtn.style.cssText =
    "padding:6px 16px;border:1px solid #cf222e;border-radius:6px;" +
    "background:#fff;color:#cf222e;cursor:pointer;font-size:13px;" +
    "margin-right:auto;";
  deleteBtn.onclick = async () => {
    const selected = recoveries[selectedIdx];
    if (!selected) return;

    // Remove the backup file
    if (selected._backupFile) {
      try { await window.mdpad.removeOrphanedBackup(selected._backupFile); } catch {}
    }
    if (selected._sessionFile) {
      // Session files also need cleanup — use the same IPC
      try { await window.mdpad.removeOrphanedBackup(selected._sessionFile); } catch {}
    }

    // Remove from autosaves array too
    if (autosaves) {
      const aIdx = autosaves.indexOf(selected);
      if (aIdx !== -1) autosaves.splice(aIdx, 1);
    }

    // Remove from recoveries list
    recoveries.splice(selectedIdx, 1);

    // If no more items, close modal
    if (recoveries.length === 0) {
      overlay.remove();
      focus();
      return;
    }

    // Adjust selection
    if (selectedIdx >= recoveries.length) {
      selectedIdx = recoveries.length - 1;
    }
    renderList();
  };

  const laterBtn = document.createElement("button");
  laterBtn.textContent = t("recovery.later");
  laterBtn.style.cssText =
    "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;";
  laterBtn.onclick = () => { overlay.remove(); focus(); };

  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = t("recovery.restoreSelected");
  restoreBtn.style.cssText =
    "padding:6px 16px;border:none;border-radius:6px;" +
    "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
  restoreBtn.onclick = () => doRestore();

  btnRow.appendChild(deleteBtn);
  btnRow.appendChild(laterBtn);
  btnRow.appendChild(restoreBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Keyboard support
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      doRestore();
    } else if (e.key === "ArrowDown" && selectedIdx < recoveries.length - 1) {
      selectedIdx++;
      renderList();
    } else if (e.key === "ArrowUp" && selectedIdx > 0) {
      selectedIdx--;
      renderList();
    }
  });

  // Focus the overlay for keyboard
  overlay.tabIndex = -1;
  overlay.focus();

  async function doRestore() {
    const selected = recoveries[selectedIdx];
    if (!selected) return;

    // If content is empty but we have a filePath, try reading from the file
    if (!selected.content && selected.filePath) {
      try {
        const fileData = await window.mdpad.openFileByPath(selected.filePath);
        if (fileData && fileData.content) {
          selected.content = fileData.content;
        }
      } catch {
        // File might not exist anymore
      }
    }

    // Still no content — nothing to restore
    if (selected.content == null) return;

    // If current document is dirty, ask for confirmation
    if (isDirty) {
      const confirmed = await showConfirmReplaceDialog();
      if (!confirmed) return;
    }

    // Perform restore
    await performRestore(selected);

    // Cleanup only the restored backup (not all orphans)
    if (selected._backupFile) {
      try { await window.mdpad.removeOrphanedBackup(selected._backupFile); } catch {}
    }
    if (selected._sessionFile) {
      try { await window.mdpad.removeOrphanedBackup(selected._sessionFile); } catch {}
    }

    overlay.remove();
    focus();
  }
}

function showConfirmReplaceDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,0.3);z-index:10000;" +
      "display:flex;align-items:center;justify-content:center;";

    const dialog = document.createElement("div");
    dialog.style.cssText =
      "background:#fff;border:1px solid #d0d7de;border-radius:8px;" +
      "padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,0.15);";

    const msg = document.createElement("div");
    msg.textContent = t("recovery.confirmReplace");
    msg.style.cssText = "font-size:14px;color:#24292f;margin-bottom:16px;line-height:1.5;";
    dialog.appendChild(msg);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = t("recovery.confirmCancel");
    cancelBtn.style.cssText =
      "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
      "background:#f6f8fa;cursor:pointer;font-size:13px;";
    cancelBtn.onclick = () => { overlay.remove(); resolve(false); };

    const discardBtn = document.createElement("button");
    discardBtn.textContent = t("recovery.confirmDiscard");
    discardBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:6px;" +
      "background:#cf222e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
    discardBtn.onclick = () => { overlay.remove(); resolve(true); };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(discardBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { overlay.remove(); resolve(false); }
    });
    overlay.tabIndex = -1;
    overlay.focus();
  });
}

async function performRestore(rec) {
  if (rec.filePath) {
    currentFilePath = rec.filePath;
  } else {
    currentFilePath = null;
  }

  // Set content without triggering isDirty, then reset history
  suppressDirty = true;
  setContent(rec.content);
  clearHistory();
  suppressDirty = false;
  setPreviewBaseDir(currentFilePath);

  // Restore originalContent for diff
  if (rec.source === "autosave" && rec.originalContent) {
    originalContent = rec.originalContent;
    setOriginalContent(rec.originalContent);
  } else if (rec.filePath) {
    try {
      const orig = await window.mdpad.openFileByPath(rec.filePath);
      if (orig) {
        originalContent = orig.content;
        setOriginalContent(orig.content);
      }
    } catch {
      // Ignore
    }
  } else {
    originalContent = "";
    setOriginalContent("");
  }

  isDirty = true;
  updateTitle();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(rec.content);
  if (state.diff) updateDiff(rec.content, originalContent);

  // Re-trigger global search if active, to fix search after recovery
  triggerGlobalSearchUpdate();
}

async function cleanupOrphans(autosaves) {
  if (autosaves) {
    for (const backup of autosaves) {
      if (backup._backupFile) {
        try { await window.mdpad.removeOrphanedBackup(backup._backupFile); } catch {}
      }
    }
  }
}

// --- Close dialog (HTML modal, replaces native dialog) ---

function showCloseDialog(closeState) {
  // Prevent duplicate
  if (document.getElementById("close-dialog-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "close-dialog-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.4);z-index:10000;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

  const modal = document.createElement("div");
  modal.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
    "padding:20px;width:520px;box-shadow:0 8px 24px rgba(0,0,0,0.2);";

  // Title row with × button
  const titleRow = document.createElement("div");
  titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;";

  const titleEl = document.createElement("div");
  titleEl.textContent = t("dialog.closeTitle");
  titleEl.style.cssText = "font-size:16px;font-weight:700;color:#24292f;";
  titleRow.appendChild(titleEl);

  const closeXBtn = document.createElement("button");
  closeXBtn.textContent = "×";
  closeXBtn.style.cssText =
    "border:none;background:transparent;font-size:20px;color:#57606a;" +
    "cursor:pointer;padding:0 4px;line-height:1;";
  closeXBtn.onclick = () => doResult("cancel");
  titleRow.appendChild(closeXBtn);
  modal.appendChild(titleRow);

  // Message
  const msgEl = document.createElement("div");
  msgEl.textContent = t("dialog.closeDetail");
  msgEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:16px;line-height:1.5;";
  modal.appendChild(msgEl);

  // Buttons row
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;align-items:center;";

  // [保存せず終了] — destructive, left-aligned, red, separated
  const exitNoSaveBtn = document.createElement("button");
  exitNoSaveBtn.textContent = t("dialog.closeExitNoSave");
  exitNoSaveBtn.style.cssText =
    "padding:6px 16px;border:1px solid #cf222e;border-radius:6px;" +
    "background:#fff;color:#cf222e;cursor:pointer;font-size:13px;" +
    "margin-right:auto;";
  exitNoSaveBtn.onclick = () => doResult("exitNoSave");

  // [リジューム保存] — secondary
  const resumeBtn = document.createElement("button");
  resumeBtn.textContent = t("dialog.closeResumeSave");
  resumeBtn.style.cssText =
    "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;";
  resumeBtn.onclick = () => doResult("resumeSave");

  if (closeState.hasFilePath) {
    // Existing file: [保存せず終了]  [リジューム保存] [名前を付けて保存] [上書き保存して終了]
    const saveAsBtn = document.createElement("button");
    saveAsBtn.textContent = t("dialog.closeSaveAs");
    saveAsBtn.style.cssText =
      "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
      "background:#f6f8fa;cursor:pointer;font-size:13px;";
    saveAsBtn.onclick = () => doResult("saveAs");

    const saveBtn = document.createElement("button");
    saveBtn.textContent = t("dialog.closeSaveAndExit");
    saveBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:6px;" +
      "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
    saveBtn.onclick = () => doResult("save");

    // tabindex: primary first, then secondaries, destructive last
    saveBtn.tabIndex = 1;
    saveAsBtn.tabIndex = 2;
    resumeBtn.tabIndex = 3;
    exitNoSaveBtn.tabIndex = 4;

    btnRow.appendChild(exitNoSaveBtn);
    btnRow.appendChild(resumeBtn);
    btnRow.appendChild(saveAsBtn);
    btnRow.appendChild(saveBtn);
  } else {
    // New file: [保存せず終了]  [リジューム保存] [名前を付けて保存]
    const saveAsBtn = document.createElement("button");
    saveAsBtn.textContent = t("dialog.closeSaveAs");
    saveAsBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:6px;" +
      "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
    saveAsBtn.onclick = () => doResult("saveAs");

    // tabindex: primary first, then secondaries, destructive last
    saveAsBtn.tabIndex = 1;
    resumeBtn.tabIndex = 2;
    exitNoSaveBtn.tabIndex = 3;

    btnRow.appendChild(exitNoSaveBtn);
    btnRow.appendChild(resumeBtn);
    btnRow.appendChild(saveAsBtn);
  }

  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Keyboard support
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      doResult("cancel");
    }
  });

  // Click overlay background → cancel
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) doResult("cancel");
  });

  // Focus the primary button
  const firstBtn = modal.querySelector("[tabindex='1']");
  if (firstBtn) firstBtn.focus();

  function doResult(result) {
    overlay.remove();
    window.mdpad.sendCloseDialogResult(result);
  }
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
