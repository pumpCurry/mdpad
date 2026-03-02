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
import { initPreview, updatePreview, updatePreviewImmediate, setOriginalContent, setPreviewBaseDir, setGitAvailable, clearGitHeadCache, setPreviewMode, setDiffSource } from "./components/preview-pane.js";
import { initDiff, updateDiff, setDiffGitAvailable, clearDiffGitHeadCache } from "./components/diff-pane.js";
import {
  initPaneManager,
  togglePane,
  setPaneState,
  getPaneState,
  onPaneChange,
} from "./components/pane-manager.js";
import { initToolbar, updateButtonStates } from "./components/toolbar.js";
import { initStatusBar, updateStatusBar, setGitInfo, setEolDisplay } from "./components/status-bar.js";
import { initGlobalSearch, triggerGlobalSearchUpdate, isDndInsertMode } from "./components/global-search.js";
import { syncEditorToPreview } from "./lib/scroll-sync.js";
import { initI18n, t, setLocale, onLocaleChange } from "../i18n/i18n-renderer.js";
import { initFormatContextMenu } from "./components/format-context-menu.js";
import { initFormatToolbar, setFormatBarMode, getFormatBarMode } from "./components/format-toolbar.js";
import { getFormatCommand, isFormatActive } from "./components/format-commands.js";
import { initEmojiPicker } from "./components/emoji-picker.js";
import { initTocPane, updateToc, updateTocHighlight, updateTocViewport } from "./components/toc-pane.js";
import { renderMarkdown } from "./lib/markdown-engine.js";

// Application state
let currentFilePath = null;
let originalContent = "";
let isDirty = false;
let suppressDirty = false; // Suppress isDirty changes during programmatic setContent
let currentEol = navigator.platform.startsWith("Win") ? "CRLF" : "LF"; // Current line ending type

// Session auto-save interval (ms) — lightweight, always on
const SESSION_SAVE_INTERVAL = 5000;

// Autosave (backup) state
let autosaveMinutes = 0; // 0 = OFF
let autosaveTimer = null;
let autosaveNextAt = 0; // timestamp (ms) of next autosave, 0 = not scheduled

// File watch settings
let fileWatchEnabled = true;
let autoReloadEnabled = true;

// Pending pane config for external file open (race condition fix)
// apply-pane-config IPC が dropOpenFile: より先に到着した場合に保留する
let _pendingPaneConfig = null;

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

  // Init format context menu (right-click)
  initFormatContextMenu();

  // Init format toolbar (topbar/sidebar/hidden)
  initFormatToolbar();

  // Init emoji picker (registers callback with toolbar)
  initEmojiPicker();

  // Init TOC (Table of Contents) pane
  initTocPane();

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
    // TOC 表示状態を localStorage に保存し、表示時は内容を即座に更新
    localStorage.setItem("mdpad:tocVisible", String(state.toc));
    if (state.toc) {
      updateToc(getContent());
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
      // TOC ビューポート追随: エディタの表示範囲内の見出しをハイライト
      if (state.toc) {
        const scrollTop = editor.scrollDOM.scrollTop;
        const clientHeight = editor.scrollDOM.clientHeight;
        const topBlock = editor.lineBlockAtHeight(scrollTop);
        const bottomBlock = editor.lineBlockAtHeight(scrollTop + clientHeight);
        const topLine = editor.state.doc.lineAt(topBlock.from).number;
        const bottomLine = editor.state.doc.lineAt(bottomBlock.from).number;
        updateTocViewport(topLine, bottomLine);
      }
    });
  }

  // Editor cursor/selection update for status bar + TOC カーソル追随
  const editorView = getEditor();
  if (editorView) {
    setInterval(() => {
      updateStatusBar();
      // TOC カーソル追随: カーソルが属する見出しセクションをハイライト
      const state = getPaneState();
      if (state.toc) {
        const info = getCursorInfo();
        updateTocHighlight(info.line);
      }
    }, 200);
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

  // Status bar click → EOL selection menu
  window.addEventListener("mdpad:showEolMenu", (e) => showEolMenu(e.detail.target));

  // Close EOL popup when a modal dialog opens
  window.addEventListener("mdpad:closePopups", () => {
    const eolPopup = document.getElementById("eol-popup");
    if (eolPopup) eolPopup.remove();
  });

  // Expose close-state getter for main process (via executeJavaScript)
  window.__mdpadGetCloseState = () => ({
    isDirty,
    hasFilePath: !!currentFilePath,
    filePath: currentFilePath,
  });

  // Expose content getter for main process save-on-close
  window.__mdpadGetContent = () => getContent();

  // Expose currentEol getter for main process save-on-close
  window.__mdpadGetCurrentEol = () => currentEol;

  // Expose currentFilePath getter for preview-pane git diff
  window.__mdpadGetCurrentFilePath = () => currentFilePath;

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

  // Expose handleMenuAction for smoke tests (CDP can't trigger IPC-based menu actions)
  window.__mdpadHandleMenuAction = (action) => handleMenuAction(action);

  // Expose set-and-select helper for smoke tests (format command verification)
  window.__mdpadSetAndSelect = (text, from, to) => {
    const view = getEditor();
    if (!view) return "NO_EDITOR";
    suppressDirty = true;
    const spec = { changes: { from: 0, to: view.state.doc.length, insert: text } };
    if (from !== undefined && to !== undefined) {
      spec.selection = { anchor: from, head: to };
    }
    view.dispatch(spec);
    suppressDirty = false;
    view.focus();
    return "OK";
  };

  // Expose direct format command executor for smoke tests (bypasses toolbar DOM)
  window.__mdpadExecFormat = (formatId) => {
    const cmd = getFormatCommand(formatId);
    const view = getEditor();
    if (!cmd || !view) return "NO_CMD_OR_EDITOR";
    if (cmd.fn) cmd.fn(view);
    view.focus();
    return view.state.doc.toString();
  };

  // Expose preview update for smoke tests (suppressDirty blocks auto-update)
  window.__mdpadUpdatePreview = () => {
    const state = getPaneState();
    if (state.preview) updatePreviewImmediate(getContent());
  };

  // Expose format active state checker for smoke tests
  window.__mdpadIsFormatActive = (formatId) => {
    const view = getEditor();
    if (!view) return false;
    return isFormatActive(view, formatId);
  };

  // Session auto-save for crash recovery (lightweight, always on)
  setInterval(() => {
    if (isDirty) {
      saveSessionState();
    }
  }, SESSION_SAVE_INTERVAL);

  // Initialize autosave (backup) settings — timer starts on first edit, not at init
  autosaveMinutes = await window.mdpad.getAutosaveMinutes();

  // Initialize file watch settings
  fileWatchEnabled = await window.mdpad.getFileWatchEnabled();
  autoReloadEnabled = await window.mdpad.getAutoReloadEnabled();

  // File watching: handle external file changes
  window.mdpad.onFileChanged(() => {
    if (!isDirty) {
      if (autoReloadEnabled) {
        // Not dirty + auto-reload ON → silent reload
        reloadCurrentFile();
      } else {
        // Not dirty + auto-reload OFF → simple 2-button dialog
        showSimpleReloadDialog();
      }
    } else {
      // Dirty → 3-button dialog (discard+reload / save+reload / ignore)
      showFileChangedDirtyDialog();
    }
  });

  // Pane config listener (for external file open smart layout)
  // ファイルがまだ読み込まれていない場合は pending に保存し、
  // loadFileByPath 完了後に適用する（レースコンディション回避）
  window.mdpad.onApplyPaneConfig((config) => {
    if (!currentFilePath) {
      _pendingPaneConfig = config;
    } else {
      applyExternalOpenLayout(config);
    }
  });

  // Check for crash recovery: sessions first, then autosave backups
  // Skip if this window was opened with a file (e.g. drop, file association)
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has("hasFile")) {
    await checkRecovery();
  }

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
  const wasDirty = isDirty;
  isDirty = true;
  // Start autosave timer on first edit (false→true transition)
  if (!wasDirty && !autosaveTimer && autosaveMinutes > 0) {
    startAutosaveTimer();
  }
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

  // Update TOC (debounced internally)
  updateToc(content);

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

  // Handle file opened in new window via drag-drop or file association
  if (action.startsWith("dropOpenFile:")) {
    const filePath = action.substring("dropOpenFile:".length);
    await loadFileByPath(filePath);
    // ファイル読み込み完了後、保留中のペイン設定を適用（レースコンディション回避）
    if (_pendingPaneConfig) {
      await applyExternalOpenLayout(_pendingPaneConfig);
      _pendingPaneConfig = null;
    }
    return;
  }

  // Handle recent file open from menu
  if (action.startsWith("openRecent:")) {
    const filePath = action.substring("openRecent:".length);
    await openFileInCurrentWindow(filePath);
    return;
  }

  // Handle file watch toggle from menu
  if (action.startsWith("setFileWatch:")) {
    const enabled = action.split(":")[1] === "1";
    fileWatchEnabled = enabled;
    await window.mdpad.setFileWatchEnabled(enabled);
    if (!enabled) {
      stopFileWatch();
    } else if (currentFilePath) {
      startFileWatch(currentFilePath);
    }
    return;
  }

  // Handle auto-reload toggle from menu
  if (action.startsWith("setAutoReload:")) {
    const enabled = action.split(":")[1] === "1";
    autoReloadEnabled = enabled;
    await window.mdpad.setAutoReloadEnabled(enabled);
    return;
  }

  // Handle format bar mode change from menu
  if (action.startsWith("setFormatBar:")) {
    const mode = action.split(":")[1];
    setFormatBarMode(mode);
    return;
  }

  // Handle autosave interval change from menu
  if (action.startsWith("setAutosave:")) {
    const minutes = parseInt(action.split(":")[1], 10);
    autosaveMinutes = minutes;
    await window.mdpad.setAutosaveMinutes(minutes);
    // If currently dirty, start/restart the timer; otherwise stop it
    if (isDirty && minutes > 0) {
      startAutosaveTimer();
    } else {
      stopAutosaveTimer();
    }
    return;
  }

  switch (action) {
    case "new":
      await newFile();
      break;
    case "open":
      await openFile();
      break;
    case "reload":
      await handleReload();
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
    case "toggleMinimap":
      {
        const editor = getEditor();
        if (editor) {
          const { toggleMinimap } = await import("./components/minimap.js");
          toggleMinimap(editor);
        }
      }
      break;
    case "toggleToc":
      {
        togglePane("toc");
        updateButtonStates();
        // TOC が表示された場合、現在の内容で更新
        if (getPaneState().toc) {
          const content = getContent();
          if (content) updateToc(content);
        }
      }
      break;
    case "toggleLint":
      {
        const editor = getEditor();
        if (editor) {
          const { toggleLint } = await import("./components/markdown-linter.js");
          toggleLint(editor);
        }
      }
      break;
    case "toggleLintPanel":
      {
        const editor = getEditor();
        if (editor) {
          const { openLintPanelAction } = await import("./components/markdown-linter.js");
          openLintPanelAction(editor);
        }
      }
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
    case "properties":
      showPropertiesDialog();
      break;
    case "about":
      showAboutDialog();
      break;
    case "checkForUpdates":
      showCheckForUpdatesDialog();
      break;
  }
}

function showGoToLineDialog() {
  // Prevent duplicate dialogs
  if (document.getElementById("goto-line-overlay")) return;

  // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
  window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

  const info = getCursorInfo();
  const totalLines = info.totalLines || 0;

  // Create overlay
  const overlay = document.createElement("div");
  overlay.id = "goto-line-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.3);z-index:100001;" +
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

async function showCheckForUpdatesDialog() {
  // Prevent duplicate or stacking with other modal dialogs
  if (document.getElementById("update-overlay")) return;
  if (document.getElementById("about-overlay")) return;

  // Close any open popups
  window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

  const overlay = document.createElement("div");
  overlay.id = "update-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.3);z-index:100001;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

  const dialog = document.createElement("div");
  dialog.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:12px;" +
    "padding:28px 32px;width:520px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,0.18);text-align:center;";

  // Spinner / checking message
  const statusEl = document.createElement("div");
  statusEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:16px;";
  statusEl.textContent = t("update.checking");
  dialog.appendChild(statusEl);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    focus();
  }

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      close();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  // Focus overlay so keydown works
  overlay.tabIndex = -1;
  overlay.focus();

  // Fetch update info
  let result;
  try {
    result = await window.mdpad.checkForUpdates();
  } catch {
    result = { error: "IPC error" };
  }

  // Clear checking message
  statusEl.remove();

  if (result.error) {
    // Error state
    const iconEl = document.createElement("div");
    iconEl.textContent = "⚠";
    iconEl.style.cssText = "font-size:36px;margin-bottom:8px;";
    dialog.insertBefore(iconEl, dialog.firstChild);

    const titleEl = document.createElement("div");
    titleEl.textContent = t("update.error");
    titleEl.style.cssText = "font-size:16px;font-weight:600;color:#24292f;margin-bottom:8px;";
    dialog.appendChild(titleEl);

    const detailEl = document.createElement("div");
    detailEl.textContent = t("update.errorDetail");
    detailEl.style.cssText = "font-size:13px;color:#57606a;margin-bottom:16px;";
    dialog.appendChild(detailEl);
  } else if (result.isUpdateAvailable) {
    // Update available
    const iconEl = document.createElement("div");
    iconEl.textContent = "🎉";
    iconEl.style.cssText = "font-size:36px;margin-bottom:8px;";
    dialog.insertBefore(iconEl, dialog.firstChild);

    const titleEl = document.createElement("div");
    titleEl.textContent = t("update.available");
    titleEl.style.cssText = "font-size:16px;font-weight:600;color:#24292f;margin-bottom:12px;";
    dialog.appendChild(titleEl);

    const infoEl = document.createElement("div");
    infoEl.style.cssText = "font-size:13px;color:#57606a;margin-bottom:12px;text-align:left;line-height:1.6;";
    infoEl.innerHTML =
      `<div>${t("update.currentVersion")} <code style="background:#f6f8fa;padding:2px 6px;border-radius:3px;font-size:12px;">${result.currentVersion}</code></div>` +
      `<div>${t("update.latestVersion")} <code style="background:#f6f8fa;padding:2px 6px;border-radius:3px;font-size:12px;color:#1a7f37;font-weight:600;">${result.latestVersion}</code></div>`;
    dialog.appendChild(infoEl);

    // Release notes (if any) — Markdown で描画する
    if (result.releaseNotes) {
      const notesLabel = document.createElement("div");
      notesLabel.textContent = t("update.releaseNotes");
      notesLabel.style.cssText = "font-size:12px;color:#57606a;text-align:left;margin-bottom:4px;";
      dialog.appendChild(notesLabel);

      const notesEl = document.createElement("div");
      // markdown-it で HTML に変換して描画（リリースノートは GitHub Releases の Markdown）
      notesEl.innerHTML = renderMarkdown(result.releaseNotes);
      notesEl.classList.add("markdown-body");
      notesEl.style.cssText =
        "font-size:13px;color:#24292f;text-align:left;margin-bottom:16px;" +
        "background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px 16px;" +
        "max-height:300px;overflow-y:auto;line-height:1.5;" +
        "word-wrap:break-word;overflow-wrap:break-word;";

      // Markdown 内の画像・コードブロックがダイアログからはみ出さないようスコープ付きスタイル
      const scopedStyle = document.createElement("style");
      scopedStyle.textContent = [
        "#update-overlay .markdown-body img { max-width: 100%; height: auto; }",
        "#update-overlay .markdown-body pre { overflow-x: auto; max-width: 100%; }",
        "#update-overlay .markdown-body h1 { font-size: 1.3em; border-bottom: 1px solid #d0d7de; padding-bottom: 4px; }",
        "#update-overlay .markdown-body h2 { font-size: 1.15em; border-bottom: 1px solid #d0d7de; padding-bottom: 3px; }",
        "#update-overlay .markdown-body h3 { font-size: 1.05em; }",
        "#update-overlay .markdown-body p { margin: 6px 0; }",
        "#update-overlay .markdown-body ul, #update-overlay .markdown-body ol { padding-left: 20px; margin: 6px 0; }",
        "#update-overlay .markdown-body code { font-size: 12px; background: #eaeef2; padding: 1px 4px; border-radius: 3px; }",
        "#update-overlay .markdown-body pre code { background: none; padding: 0; }",
      ].join("\n");
      notesEl.prepend(scopedStyle);

      dialog.appendChild(notesEl);
    }

    // Download button
    const dlBtn = document.createElement("button");
    dlBtn.textContent = t("update.download");
    dlBtn.style.cssText =
      "padding:8px 24px;border:none;border-radius:6px;" +
      "background:#1a7f37;color:#fff;cursor:pointer;font-size:14px;font-weight:600;" +
      "margin-right:8px;transition:background 0.15s;";
    dlBtn.onmouseover = () => { dlBtn.style.background = "#16653a"; };
    dlBtn.onmouseout = () => { dlBtn.style.background = "#1a7f37"; };
    dlBtn.onclick = () => {
      window.mdpad.openExternal(result.downloadUrl);
      close();
    };
    dialog.appendChild(dlBtn);
  } else {
    // Up to date
    const iconEl = document.createElement("div");
    iconEl.textContent = "✔";
    iconEl.style.cssText = "font-size:36px;margin-bottom:8px;color:#1a7f37;";
    dialog.insertBefore(iconEl, dialog.firstChild);

    const titleEl = document.createElement("div");
    titleEl.textContent = t("update.upToDate");
    titleEl.style.cssText = "font-size:16px;font-weight:600;color:#24292f;margin-bottom:8px;";
    dialog.appendChild(titleEl);

    const verEl = document.createElement("div");
    verEl.textContent = result.currentVersion;
    verEl.style.cssText =
      "font-size:13px;color:#8b949e;margin-bottom:16px;" +
      "font-family:'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;";
    dialog.appendChild(verEl);
  }

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = t("update.close");
  closeBtn.style.cssText =
    "padding:6px 24px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;color:#24292f;" +
    "transition:background 0.15s;";
  closeBtn.onmouseover = () => { closeBtn.style.background = "#e8ebef"; };
  closeBtn.onmouseout = () => { closeBtn.style.background = "#f6f8fa"; };
  closeBtn.onclick = close;
  dialog.appendChild(closeBtn);

  closeBtn.focus();
}

async function showAboutDialog() {
  // Prevent duplicate or stacking with other modal dialogs
  if (document.getElementById("about-overlay")) return;
  if (document.getElementById("update-overlay")) return;

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

    // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
    window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

    const overlay = document.createElement("div");
    overlay.id = "confirm-save-overlay";
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,0.4);z-index:100001;" +
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

/**
 * Fetch git info for the current file and update UI components.
 */
async function refreshGitInfo() {
  if (!currentFilePath) {
    setGitInfo(null);
    setGitAvailable(false);
    setDiffGitAvailable(false);
    clearGitHeadCache();
    clearDiffGitHeadCache();
    return;
  }
  try {
    const info = await window.mdpad.getGitInfo(currentFilePath);
    setGitInfo(info);
    const tracked = !!info && info.isTracked;
    setGitAvailable(tracked);
    setDiffGitAvailable(tracked);
    clearGitHeadCache();
    clearDiffGitHeadCache();
  } catch {
    setGitInfo(null);
    setGitAvailable(false);
    setDiffGitAvailable(false);
  }
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
  currentEol = navigator.platform.startsWith("Win") ? "CRLF" : "LF";
  setEolDisplay(currentEol);
  setContentClean("");
  setOriginalContent("");
  setPreviewBaseDir(null);
  stopAutosaveTimer();
  stopFileWatch();
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate("");
  if (state.diff) updateDiff("", "");
  refreshGitInfo();
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
  // Update EOL from detected value; Mixed falls back to OS default
  const defaultEol = navigator.platform.startsWith("Win") ? "CRLF" : "LF";
  currentEol = (result.eol && result.eol !== "Mixed") ? result.eol : defaultEol;
  setEolDisplay(currentEol);
  setContentClean(result.content);
  setOriginalContent(result.content);
  setPreviewBaseDir(result.path);
  stopAutosaveTimer();
  startFileWatch(result.path);
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(result.content);
  if (state.diff) updateDiff(result.content, originalContent);
  refreshGitInfo();
}

async function saveFile() {
  if (!currentFilePath) {
    return await saveFileAs();
  }
  const content = getContent();
  const contentToWrite = applyEol(content, currentEol);
  // Self-write protection: ignore file watcher events during save
  await window.mdpad.setFileIgnoring(true);
  await window.mdpad.saveFile(currentFilePath, contentToWrite);
  setTimeout(() => window.mdpad.setFileIgnoring(false), 1000);
  originalContent = content;
  setOriginalContent(content);
  isDirty = false;
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();
  await window.mdpad.invalidateGitCache(currentFilePath);
  refreshGitInfo();
  return true;
}

async function saveFileAs() {
  const content = getContent();
  const contentToWrite = applyEol(content, currentEol);
  const result = await window.mdpad.saveFileAs(contentToWrite, currentFilePath);
  if (!result) return false;
  // Self-write protection: ignore file watcher events during save
  await window.mdpad.setFileIgnoring(true);
  setTimeout(() => window.mdpad.setFileIgnoring(false), 1000);
  currentFilePath = result.path;
  originalContent = content;
  setOriginalContent(content);
  setPreviewBaseDir(result.path);
  isDirty = false;
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();
  await window.mdpad.invalidateGitCache(currentFilePath);
  refreshGitInfo();
  // Start watching the new file path
  startFileWatch(result.path);
  return true;
}

// --- Load file by path (used by drag-drop new window) ---

async function loadFileByPath(filePath) {
  const result = await window.mdpad.openFileByPath(filePath);
  if (!result) return;

  currentFilePath = result.path;
  originalContent = result.content;
  isDirty = false;
  const defaultEol = navigator.platform.startsWith("Win") ? "CRLF" : "LF";
  currentEol = (result.eol && result.eol !== "Mixed") ? result.eol : defaultEol;
  setEolDisplay(currentEol);
  setContentClean(result.content);
  setOriginalContent(result.content);
  setPreviewBaseDir(result.path);
  stopAutosaveTimer();
  startFileWatch(result.path);
  updateTitle();
  await window.mdpad.clearSession();
  await window.mdpad.clearAutosaveBackup();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(result.content);
  if (state.diff) updateDiff(result.content, originalContent);
  refreshGitInfo();
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
  // ファイル読み込み完了後、スマートレイアウトを適用
  // （プレビューペインの自動表示）
  await applyExternalOpenLayout("__smart__");
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

// --- File watching ---

async function startFileWatch(filePath) {
  await window.mdpad.unwatchFile(); // Stop any previous watch
  if (filePath && fileWatchEnabled) {
    await window.mdpad.watchFile(filePath);
  }
}

async function stopFileWatch() {
  await window.mdpad.unwatchFile();
}

/**
 * Reload the current file from disk (used when external change detected).
 */
async function reloadCurrentFile() {
  if (!currentFilePath) return;
  const result = await window.mdpad.openFileByPath(currentFilePath);
  if (!result) return;

  originalContent = result.content;
  isDirty = false;
  const defaultEol = navigator.platform.startsWith("Win") ? "CRLF" : "LF";
  currentEol = (result.eol && result.eol !== "Mixed") ? result.eol : defaultEol;
  setEolDisplay(currentEol);
  setContentClean(result.content);
  setOriginalContent(result.content);
  stopAutosaveTimer();
  updateTitle();

  const state = getPaneState();
  if (state.preview) updatePreviewImmediate(result.content);
  if (state.diff) updateDiff(result.content, originalContent);

  // Re-fetch git info (file may have changed in repo)
  await window.mdpad.invalidateGitCache(currentFilePath);
  clearGitHeadCache();
  clearDiffGitHeadCache();
  refreshGitInfo();

  triggerGlobalSearchUpdate();
}

/**
 * Handle F5/menu reload action.
 * If no file is open, do nothing.
 * If clean, reload immediately.
 * If dirty, show 3-button dialog.
 */
async function handleReload() {
  if (!currentFilePath) return;
  if (!isDirty) {
    await reloadCurrentFile();
    return;
  }
  // Dirty — show reload confirmation dialog
  const result = await showReloadConfirmDialog({
    title: t("reload.title"),
    message: t("reload.message"),
    discardLabel: t("reload.discardReload"),
    saveLabel: t("reload.saveReload"),
    cancelLabel: t("reload.cancel"),
    overlayId: "reload-overlay",
  });
  if (result === "discard") {
    // Save backup before discarding
    await saveResumeBackupNow();
    await reloadCurrentFile();
  } else if (result === "save") {
    const saved = await saveFile();
    if (saved) {
      await reloadCurrentFile();
    }
  }
  // "cancel" → do nothing
  focus();
}

/**
 * Save a resume backup of current state (for discard+reload flows).
 */
async function saveResumeBackupNow() {
  try {
    await window.mdpad.saveResumeBackup({
      content: getContent(),
      filePath: currentFilePath,
      originalContent: originalContent,
      isDirty: true,
    });
  } catch {
    // Ignore
  }
}

/**
 * Shared 3-button reload confirmation dialog.
 * Layout: [Discard & Reload] (left, red)  [Cancel/Ignore] (gray)  [Save & Reload] (green)
 * Returns: Promise<"discard" | "save" | "cancel">
 */
function showReloadConfirmDialog({ title, message, discardLabel, saveLabel, cancelLabel, overlayId }) {
  return new Promise((resolve) => {
    // Prevent duplicate
    if (document.getElementById(overlayId)) {
      resolve("cancel");
      return;
    }

    // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
    window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,0.4);z-index:100001;" +
      "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

    const modal = document.createElement("div");
    modal.style.cssText =
      "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
      "padding:20px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.2);";

    // Title row with x button
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;";

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.cssText = "font-size:16px;font-weight:700;color:#24292f;";
    titleRow.appendChild(titleEl);

    const closeXBtn = document.createElement("button");
    closeXBtn.textContent = "\u00d7";
    closeXBtn.style.cssText =
      "border:none;background:transparent;font-size:20px;color:#57606a;" +
      "cursor:pointer;padding:0 4px;line-height:1;";
    closeXBtn.onclick = () => done("cancel");
    titleRow.appendChild(closeXBtn);
    modal.appendChild(titleRow);

    const msgEl = document.createElement("div");
    msgEl.textContent = message;
    msgEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:16px;line-height:1.5;";
    modal.appendChild(msgEl);

    // Buttons: [Discard] ...space... [Cancel] [Save]
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const discardBtn = document.createElement("button");
    discardBtn.textContent = discardLabel;
    discardBtn.style.cssText =
      "padding:6px 16px;border:1px solid #cf222e;border-radius:6px;" +
      "background:#fff;color:#cf222e;cursor:pointer;font-size:13px;" +
      "margin-right:auto;";
    discardBtn.tabIndex = 3;
    discardBtn.onclick = () => done("discard");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = cancelLabel;
    cancelBtn.style.cssText =
      "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
      "background:#f6f8fa;cursor:pointer;font-size:13px;";
    cancelBtn.tabIndex = 2;
    cancelBtn.onclick = () => done("cancel");

    const saveBtn = document.createElement("button");
    saveBtn.textContent = saveLabel;
    saveBtn.style.cssText =
      "padding:6px 16px;border:none;border-radius:6px;" +
      "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
    saveBtn.tabIndex = 1;
    saveBtn.onclick = () => done("save");

    btnRow.appendChild(discardBtn);
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

/**
 * Show a simple 2-button dialog when file changes externally and auto-reload is OFF.
 * Used when isDirty === false but autoReloadEnabled === false.
 */
function showSimpleReloadDialog() {
  // Prevent duplicate
  if (document.getElementById("file-changed-overlay")) return;

  // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
  window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

  const overlay = document.createElement("div");
  overlay.id = "file-changed-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.4);z-index:100001;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;";

  const modal = document.createElement("div");
  modal.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:8px;" +
    "padding:20px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.2);";

  const titleEl = document.createElement("div");
  titleEl.textContent = t("fileWatch.changed");
  titleEl.style.cssText = "font-size:16px;font-weight:700;color:#24292f;margin-bottom:8px;";
  modal.appendChild(titleEl);

  const msgEl = document.createElement("div");
  msgEl.textContent = t("fileWatch.simpleMessage");
  msgEl.style.cssText = "font-size:14px;color:#57606a;margin-bottom:16px;line-height:1.5;";
  modal.appendChild(msgEl);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

  const ignoreBtn = document.createElement("button");
  ignoreBtn.textContent = t("fileWatch.ignore");
  ignoreBtn.style.cssText =
    "padding:6px 16px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;";
  ignoreBtn.onclick = () => { overlay.remove(); focus(); };

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = t("fileWatch.reload");
  reloadBtn.style.cssText =
    "padding:6px 16px;border:none;border-radius:6px;" +
    "background:#2da44e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
  reloadBtn.onclick = async () => {
    overlay.remove();
    await reloadCurrentFile();
    focus();
  };

  btnRow.appendChild(ignoreBtn);
  btnRow.appendChild(reloadBtn);
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      overlay.remove();
      focus();
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) { overlay.remove(); focus(); }
  });

  overlay.tabIndex = -1;
  overlay.focus();
  reloadBtn.focus();
}

/**
 * Show 3-button dialog when file changes externally while user has unsaved edits.
 * Uses the shared showReloadConfirmDialog with file-watch-specific labels.
 */
async function showFileChangedDirtyDialog() {
  const result = await showReloadConfirmDialog({
    title: t("fileWatch.changed"),
    message: t("fileWatch.dirtyMessage"),
    discardLabel: t("fileWatch.discardReload"),
    saveLabel: t("fileWatch.saveReload"),
    cancelLabel: t("fileWatch.ignoreUpdate"),
    overlayId: "file-changed-overlay",
  });
  if (result === "discard") {
    await saveResumeBackupNow();
    await reloadCurrentFile();
  } else if (result === "save") {
    const saved = await saveFile();
    if (saved) {
      await reloadCurrentFile();
    }
  }
  // "cancel" → ignore
  focus();
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

/**
 * Stop the autosave timer (e.g. on new file, open file, recovery).
 * The timer will restart when the user makes the first edit.
 */
function stopAutosaveTimer() {
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
  autosaveNextAt = 0;
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
    // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
    window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,0.3);z-index:100001;" +
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
  refreshGitInfo();
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

  // Close any open popups (emoji picker, heading dropdown, context menu, etc.)
  window.dispatchEvent(new CustomEvent("mdpad:closePopups"));

  const overlay = document.createElement("div");
  overlay.id = "close-dialog-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.4);z-index:100001;" +
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

// --- Properties dialog helpers ---

/**
 * Convert a Windows path to a WSL path.
 * e.g. "C:\Users\foo\bar" → "/mnt/c/Users/foo/bar"
 */
function toWslPath(winPath) {
  if (!winPath) return "";
  // Match drive letter pattern: X:\...
  const match = winPath.match(/^([A-Za-z]):\\/);
  if (!match) return winPath.replace(/\\/g, "/");
  const driveLetter = match[1].toLowerCase();
  const rest = winPath.substring(3).replace(/\\/g, "/");
  return `/mnt/${driveLetter}/${rest}`;
}

/**
 * Count words in text with CJK support.
 * CJK characters are counted individually; Western words are space-separated.
 */
function countWords(text) {
  if (!text) return 0;
  // Count CJK characters (each is one word)
  const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkChars ? cjkChars.length : 0;

  // Remove CJK characters, then count Western words
  const withoutCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, " ");
  const westernWords = withoutCjk.trim().split(/\s+/).filter((w) => w.length > 0);
  const westernCount = westernWords.length;

  return cjkCount + westernCount;
}

/**
 * Format bytes to human-readable file size.
 */
function formatFileSize(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format ISO date string to local date/time.
 */
function formatDateLocal(isoStr) {
  if (!isoStr) return "-";
  try {
    return new Date(isoStr).toLocaleString();
  } catch {
    return isoStr;
  }
}

/**
 * Show the File Properties dialog.
 */
async function showPropertiesDialog() {
  // Prevent duplicate
  if (document.getElementById("properties-overlay")) return;

  const content = getContent();
  const lineCount = content.split("\n").length;
  const charCount = content.length;
  const wordCount = countWords(content);

  // Fetch file properties (stat) and git info
  let fileProps = null;
  let gitInfo = null;
  if (currentFilePath) {
    [fileProps, gitInfo] = await Promise.all([
      window.mdpad.getFileProperties(currentFilePath),
      window.mdpad.getDetailedGitInfo(currentFilePath),
    ]);
  }

  const overlay = document.createElement("div");
  overlay.id = "properties-overlay";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;right:0;bottom:0;" +
    "background:rgba(0,0,0,0.3);z-index:9999;" +
    "display:flex;align-items:flex-start;justify-content:center;padding-top:8vh;";

  const dialog = document.createElement("div");
  dialog.style.cssText =
    "background:#ffffff;border:1px solid #d0d7de;border-radius:12px;" +
    "padding:24px 28px;width:540px;max-height:80vh;overflow-y:auto;" +
    "box-shadow:0 12px 40px rgba(0,0,0,0.18);";

  // Title row with × button
  const titleRow = document.createElement("div");
  titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;";
  const titleEl = document.createElement("div");
  titleEl.textContent = t("properties.title");
  titleEl.style.cssText = "font-size:18px;font-weight:700;color:#24292f;";
  titleRow.appendChild(titleEl);
  const closeXBtn = document.createElement("button");
  closeXBtn.textContent = "×";
  closeXBtn.style.cssText =
    "border:none;background:transparent;font-size:22px;color:#57606a;" +
    "cursor:pointer;padding:0 4px;line-height:1;";
  closeXBtn.onclick = () => close();
  titleRow.appendChild(closeXBtn);
  dialog.appendChild(titleRow);

  // --- Section: General ---
  const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : t("app.untitled");

  addSection(dialog, null); // no section header for general

  const generalRows = [
    { label: t("properties.filename"), value: fileName, copy: true },
    { label: t("properties.fileSize"), value: fileProps ? formatFileSize(fileProps.size) : "-" },
    { label: t("properties.created"), value: fileProps ? formatDateLocal(fileProps.created) : "-" },
    { label: t("properties.modified"), value: fileProps ? formatDateLocal(fileProps.modified) : "-" },
    { label: t("properties.chars"), value: charCount.toLocaleString() },
    { label: t("properties.words"), value: wordCount.toLocaleString() },
    { label: t("properties.linesCount"), value: lineCount.toLocaleString() },
    { label: t("properties.encoding"), value: "UTF-8" },
    { label: t("properties.eol"), value: currentEol },
  ];

  const generalTable = createPropTable(generalRows);
  dialog.appendChild(generalTable);

  // --- Section: Paths (only for saved files) ---
  if (currentFilePath) {
    addSection(dialog, t("properties.sectionPaths"));

    const dirPath = currentFilePath.replace(/[\\/][^\\/]+$/, "");
    const wslPath = toWslPath(currentFilePath);
    const wslDir = toWslPath(dirPath);

    const pathRows = [
      { label: t("properties.directory"), value: dirPath, copy: true },
      { label: t("properties.fullPath"), value: currentFilePath, copy: true },
    ];

    // Add git relative path if available
    if (gitInfo && gitInfo.relPath) {
      pathRows.push({ label: t("properties.relativePath"), value: gitInfo.relPath, copy: true });
    }

    pathRows.push({ label: t("properties.wslPath"), value: wslPath, copy: true });

    const pathTable = createPropTable(pathRows);
    dialog.appendChild(pathTable);
  } else {
    addSection(dialog, t("properties.sectionPaths"));
    const noFileEl = document.createElement("div");
    noFileEl.textContent = t("properties.unsavedFile");
    noFileEl.style.cssText = "font-size:13px;color:#8b949e;padding:8px 0;font-style:italic;";
    dialog.appendChild(noFileEl);
  }

  // --- Section: Git ---
  addSection(dialog, t("properties.sectionGit"));

  if (gitInfo) {
    const gitRows = [
      { label: t("properties.gitRepo"), value: gitInfo.repoName },
      { label: t("properties.gitBranch"), value: gitInfo.branch },
      { label: t("properties.gitCommitHash"), value: gitInfo.commitHash, copy: true, mono: true },
      { label: t("properties.gitCommitCount"), value: String(gitInfo.commitCount) },
      { label: t("properties.gitTracked"), value: gitInfo.isTracked ? t("properties.gitYes") : t("properties.gitNo") },
    ];
    if (gitInfo.remoteUrl) {
      gitRows.push({ label: t("properties.gitRemoteUrl"), value: gitInfo.remoteUrl, copy: true });
    }
    if (gitInfo.relPath) {
      gitRows.push({ label: t("properties.gitRelPath"), value: gitInfo.relPath, copy: true });
    }
    const gitTable = createPropTable(gitRows);
    dialog.appendChild(gitTable);
  } else {
    const noGitEl = document.createElement("div");
    noGitEl.textContent = t("properties.noGit");
    noGitEl.style.cssText = "font-size:13px;color:#8b949e;padding:8px 0;font-style:italic;";
    dialog.appendChild(noGitEl);
  }

  // --- Close button ---
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;margin-top:16px;";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = t("properties.close");
  closeBtn.style.cssText =
    "padding:6px 24px;border:1px solid #d0d7de;border-radius:6px;" +
    "background:#f6f8fa;cursor:pointer;font-size:13px;color:#24292f;" +
    "transition:background 0.15s;";
  closeBtn.onmouseover = () => { closeBtn.style.background = "#e8ebef"; };
  closeBtn.onmouseout = () => { closeBtn.style.background = "#f6f8fa"; };
  closeBtn.onclick = () => close();
  btnRow.appendChild(closeBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  closeBtn.focus();

  // Keyboard & click-outside
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  function close() {
    overlay.remove();
    focus();
  }
}

/**
 * Add a section header to the properties dialog.
 */
function addSection(container, title) {
  if (!title) return; // No header for first section
  const header = document.createElement("div");
  header.textContent = title;
  header.style.cssText =
    "font-size:14px;font-weight:600;color:#24292f;margin-top:16px;margin-bottom:8px;" +
    "padding-top:12px;border-top:1px solid #d8dee4;";
  container.appendChild(header);
}

/**
 * Create a property table from rows.
 * Each row: { label, value, copy?, mono? }
 */
function createPropTable(rows) {
  const table = document.createElement("div");
  table.style.cssText = "display:grid;grid-template-columns:140px 1fr auto;gap:4px 8px;align-items:center;";

  for (const row of rows) {
    // Label
    const labelEl = document.createElement("div");
    labelEl.textContent = row.label;
    labelEl.style.cssText = "font-size:13px;color:#57606a;font-weight:500;padding:3px 0;";
    table.appendChild(labelEl);

    // Value
    const valueEl = document.createElement("div");
    valueEl.textContent = row.value || "-";
    valueEl.style.cssText =
      "font-size:13px;color:#24292f;padding:3px 0;overflow:hidden;text-overflow:ellipsis;" +
      "white-space:nowrap;" +
      (row.mono ? "font-family:'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;" : "");
    valueEl.title = row.value || "";
    table.appendChild(valueEl);

    // Copy button (or empty spacer)
    if (row.copy) {
      const copyBtn = document.createElement("button");
      copyBtn.textContent = t("properties.copy");
      copyBtn.style.cssText =
        "padding:2px 8px;border:1px solid #d0d7de;border-radius:4px;" +
        "background:#f6f8fa;cursor:pointer;font-size:11px;color:#57606a;" +
        "white-space:nowrap;transition:background 0.15s;";
      copyBtn.onmouseover = () => { copyBtn.style.background = "#e8ebef"; };
      copyBtn.onmouseout = () => { copyBtn.style.background = "#f6f8fa"; };
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(row.value || "").then(() => {
          copyBtn.textContent = t("properties.copied");
          copyBtn.style.color = "#2da44e";
          setTimeout(() => {
            copyBtn.textContent = t("properties.copy");
            copyBtn.style.color = "#57606a";
          }, 1500);
        });
      };
      table.appendChild(copyBtn);
    } else {
      const spacer = document.createElement("div");
      table.appendChild(spacer);
    }
  }

  return table;
}

// --- EOL helpers ---

/**
 * Convert content from CodeMirror's internal LF to the specified EOL type.
 * CodeMirror normalizes all line endings to LF internally.
 */
function applyEol(content, eolType) {
  // First normalize to LF (in case of any mixed content)
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (eolType === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (eolType === "CR") return normalized.replace(/\n/g, "\r");
  return normalized; // LF — already done
}

/**
 * Show a popup menu for EOL selection above the status bar EOL element.
 */
function showEolMenu(targetEl) {
  // Remove existing popup
  const existing = document.getElementById("eol-popup");
  if (existing) { existing.remove(); return; }

  const popup = document.createElement("div");
  popup.id = "eol-popup";
  popup.style.cssText =
    "position:fixed;z-index:9999;background:#ffffff;border:1px solid #d0d7de;" +
    "border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;" +
    "min-width:100px;";

  const options = [
    { label: "LF", value: "LF", desc: "Unix / macOS" },
    { label: "CRLF", value: "CRLF", desc: "Windows" },
    { label: "CR", value: "CR", desc: "Classic Mac" },
  ];

  for (const opt of options) {
    const item = document.createElement("div");
    item.style.cssText =
      "padding:6px 16px;cursor:pointer;font-size:13px;color:#24292f;" +
      "display:flex;align-items:center;gap:8px;white-space:nowrap;";
    item.onmouseover = () => { item.style.background = "#f6f8fa"; };
    item.onmouseout = () => { item.style.background = "transparent"; };

    const check = document.createElement("span");
    check.textContent = opt.value === currentEol ? "✓" : " ";
    check.style.cssText = "width:14px;font-size:12px;color:#0969da;text-align:center;";
    item.appendChild(check);

    const label = document.createElement("span");
    label.textContent = opt.label;
    label.style.fontWeight = opt.value === currentEol ? "600" : "400";
    item.appendChild(label);

    const desc = document.createElement("span");
    desc.textContent = opt.desc;
    desc.style.cssText = "font-size:11px;color:#8b949e;margin-left:auto;";
    item.appendChild(desc);

    item.onclick = () => {
      if (opt.value !== currentEol) {
        currentEol = opt.value;
        setEolDisplay(currentEol);
        isDirty = true;
        updateTitle();
      }
      popup.remove();
    };

    popup.appendChild(item);
  }

  document.body.appendChild(popup);

  // Position above the target element
  const rect = targetEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  popup.style.left = `${rect.left + rect.width / 2 - popupRect.width / 2}px`;
  popup.style.top = `${rect.top - popupRect.height - 4}px`;

  // Close on click outside
  function closePopup(e) {
    if (!popup.contains(e.target) && e.target !== targetEl) {
      popup.remove();
      document.removeEventListener("mousedown", closePopup);
    }
  }
  setTimeout(() => document.addEventListener("mousedown", closePopup), 0);

  // Close on Escape
  function onKey(e) {
    if (e.key === "Escape") {
      popup.remove();
      document.removeEventListener("keydown", onKey);
    }
  }
  document.addEventListener("keydown", onKey);
}

// --- External file open: smart pane layout ---

/**
 * Apply pane layout for externally opened files (CLI, file association).
 * @param {string|object} config - "__smart__" for git-aware auto, or explicit { editor, preview, diff }
 */
async function applyExternalOpenLayout(config) {
  if (typeof config === "object" && config !== null) {
    // Explicit pane config from --panes or --view CLI args
    setPaneState(config);
    updateButtonStates();
    return;
  }

  // Smart mode: git-aware layout
  if (config === "__smart__") {
    try {
      if (currentFilePath) {
        const info = await window.mdpad.getGitInfo(currentFilePath);
        if (info && info.isTracked) {
          // Check if there are differences from HEAD
          const headContent = await window.mdpad.getGitFileContent(currentFilePath);
          const currentContent = getContent();
          if (headContent !== null && headContent !== currentContent) {
            // Has diff → Preview (Rich Diff) + Diff pane, no editor
            setPaneState({ editor: false, preview: true, diff: true });
            setPreviewMode("richDiff");
            setDiffSource("git");
          } else {
            // No diff → Preview only
            setPaneState({ editor: false, preview: true, diff: false });
          }
        } else {
          // Not git-tracked → Preview only
          setPaneState({ editor: false, preview: true, diff: false });
        }
      } else {
        // No file path (shouldn't happen for external open) → Preview only
        setPaneState({ editor: false, preview: true, diff: false });
      }
    } catch {
      // Git check failed → Preview only
      setPaneState({ editor: false, preview: true, diff: false });
    }
    updateButtonStates();

    // Update pane content now that layout is set
    const state = getPaneState();
    const content = getContent();
    if (state.preview) updatePreviewImmediate(content);
    if (state.diff) updateDiff(content, originalContent);
  }
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
