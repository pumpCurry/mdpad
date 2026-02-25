const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { registerIpcHandlers } = require("./ipc-handlers");
const { createMenu } = require("./menu");
const { restoreWindowState, saveWindowState } = require("./window-state");
const { initLocale, getLocale, setLocale, getSupportedLocales, t } = require("../i18n/i18n-main");
const { initSessionManager, saveSession, getSessionDir } = require("./session-manager");
const {
  initAutosaveManager,
  getAutosaveMinutes,
  setAutosaveMinutes,
  saveAutosaveBackup,
  saveResumeBackup,
  loadOrphanedAutosaves,
  removeOrphanedBackup,
  getAutosaveDir,
} = require("./autosave-manager");
const { stopAllWatchers } = require("./file-watcher");

// Explicitly allow multiple instances — no single-instance lock.
// Each window runs as a separate process via spawnNewInstance().
// Do NOT call app.requestSingleInstanceLock() — that would block 2nd+ instances.

let mainWindow = null;
let forceQuit = false;
let ipcRegistered = false; // IPC handlers registered once globally
let nextWindowId = 1; // Unique ID for each BrowserWindow (for session/autosave isolation)

/**
 * Convert content from LF (CodeMirror internal) to specified EOL type.
 */
function applyEolMain(content, eolType) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (eolType === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (eolType === "CR") return normalized.replace(/\n/g, "\r");
  return normalized; // LF
}

function createWindow(openFilePath, paneConfig) {
  // Initialize i18n (detects OS locale or stored preference)
  initLocale();

  const bounds = restoreWindowState();

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 600,
    minHeight: 400,
    title: "mdpad",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Assign a unique window ID for session/autosave isolation
  const windowId = nextWindowId++;
  win.__mdpadWindowId = windowId;

  if (bounds.isMaximized) {
    win.maximize();
  }

  // Load renderer HTML; pass hasFile flag so renderer can skip recovery check
  if (openFilePath) {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
      query: { hasFile: "1" },
    });
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("menu:action", "dropOpenFile:" + openFilePath);
        // Send pane config for smart layout (CLI args or smart default)
        win.webContents.send("apply-pane-config", paneConfig || "__smart__");
      }
    });
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  // Helper: check if window and webContents are still alive
  function isAlive() {
    return win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed();
  }

  // Per-window forceQuit flag
  let windowForceQuit = false;

  // Close dialog result handler (renderer → main)
  // Each window gets its own resolver
  let closeDialogResolve = null;

  const closeDialogListener = (event, result) => {
    // Only handle events from this window's webContents
    if (isAlive() && event.sender === win.webContents && closeDialogResolve) {
      closeDialogResolve(result);
      closeDialogResolve = null;
    }
  };
  ipcMain.on("close:dialogResult", closeDialogListener);

  // Close handler: intercept and ask renderer for dirty state
  win.on("close", async (e) => {
    if (!win.isDestroyed()) {
      saveWindowState(win);
    }

    if (forceQuit || windowForceQuit) return; // Already confirmed, let it close

    e.preventDefault();

    // If webContents is already destroyed, just close
    if (!isAlive()) {
      windowForceQuit = true;
      clearSessionForWindow(windowId);
      clearAutosaveForWindow(windowId);
      win.close();
      return;
    }

    try {
      // Ask renderer: are you dirty? do you have a file path?
      const state = await win.webContents.executeJavaScript(
        `window.__mdpadGetCloseState ? window.__mdpadGetCloseState() : { isDirty: false, hasFilePath: false, filePath: null }`
      );

      if (!state.isDirty) {
        // Clean — close immediately, clear session + autosave
        windowForceQuit = true;
        clearSessionForWindow(windowId);
        clearAutosaveForWindow(windowId);
        win.close();
        return;
      }

      // If webContents died during await, force close
      if (!isAlive()) {
        windowForceQuit = true;
        win.close();
        return;
      }

      // Dirty — send to renderer to show HTML close dialog
      // Add timeout to prevent permanent hang if renderer never responds
      const CLOSE_DIALOG_TIMEOUT_MS = 30000;
      const resultPromise = new Promise((resolve) => {
        closeDialogResolve = resolve;
        setTimeout(() => {
          if (closeDialogResolve === resolve) {
            closeDialogResolve = null;
            resolve("_timeout");
          }
        }, CLOSE_DIALOG_TIMEOUT_MS);
      });

      win.webContents.send("close:showDialog", {
        isDirty: state.isDirty,
        hasFilePath: state.hasFilePath,
        filePath: state.filePath,
      });

      const result = await resultPromise;

      // If timed out, force close
      if (result === "_timeout") {
        windowForceQuit = true;
        clearSessionForWindow(windowId);
        clearAutosaveForWindow(windowId);
        win.close();
        return;
      }

      if (result === "save") {
        // Overwrite save (existing file)
        if (!isAlive()) { windowForceQuit = true; win.close(); return; }
        const content = await win.webContents.executeJavaScript(
          `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
        );
        const eolType = await win.webContents.executeJavaScript(
          `window.__mdpadGetCurrentEol ? window.__mdpadGetCurrentEol() : "LF"`
        );
        const contentToWrite = applyEolMain(content, eolType);
        fs.writeFileSync(state.filePath, contentToWrite, "utf-8");
        windowForceQuit = true;
        clearSessionForWindow(windowId);
        clearAutosaveForWindow(windowId);
        win.close();
      } else if (result === "saveAs") {
        // Save As dialog
        if (!isAlive()) { windowForceQuit = true; win.close(); return; }

        // Build defaultPath: existing file → its path; new file → timestamped name
        let defaultPath;
        if (state.filePath) {
          defaultPath = state.filePath;
        } else {
          const pad = (n) => String(n).padStart(2, "0");
          const now = new Date();
          const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const prefix = getLocale() === "ja" ? "無題" : "Untitled";
          defaultPath = `${prefix}_${ts}.md`;
        }

        const saveResult = await dialog.showSaveDialog(win, {
          defaultPath,
          filters: [
            { name: t("dialog.filterMarkdown"), extensions: ["md"] },
            { name: t("dialog.filterText"), extensions: ["txt"] },
            { name: t("dialog.filterAll"), extensions: ["*"] },
          ],
        });
        if (!saveResult.canceled) {
          if (!isAlive()) { windowForceQuit = true; win.close(); return; }
          const content = await win.webContents.executeJavaScript(
            `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
          );
          const eolType = await win.webContents.executeJavaScript(
            `window.__mdpadGetCurrentEol ? window.__mdpadGetCurrentEol() : "LF"`
          );
          const contentToWrite = applyEolMain(content, eolType);
          fs.writeFileSync(saveResult.filePath, contentToWrite, "utf-8");
          windowForceQuit = true;
          clearSessionForWindow(windowId);
          clearAutosaveForWindow(windowId);
          win.close();
        }
        // If canceled, stay open
      } else if (result === "resumeSave") {
        // Resume save: force backup then close
        if (!isAlive()) { windowForceQuit = true; win.close(); return; }
        const content = await win.webContents.executeJavaScript(
          `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
        );
        saveResumeBackup({
          content,
          filePath: state.filePath,
          originalContent: "",
          isDirty: true,
        }, windowId);
        windowForceQuit = true;
        clearSessionForWindow(windowId);
        win.close();
      } else if (result === "exitNoSave") {
        // Exit without saving
        windowForceQuit = true;
        clearSessionForWindow(windowId);
        clearAutosaveForWindow(windowId);
        win.close();
      }
      // If result === "cancel" or anything else, stay open
    } catch (err) {
      // If communication fails, allow close
      windowForceQuit = true;
      win.close();
    }
  });

  win.on("closed", () => {
    // Clean up the close dialog listener for this window
    ipcMain.removeListener("close:dialogResult", closeDialogListener);
    closeDialogResolve = null; // Prevent stale resolver
    if (win === mainWindow) {
      mainWindow = null;
    }
  });

  // Prevent ALL in-app navigation — the app's HTML must never be replaced.
  // Any link click, anchor, or redirect must be blocked.
  // http(s) links → open in external browser; everything else → silently block.
  let initialLoadDone = false;
  win.webContents.once("did-finish-load", () => {
    initialLoadDone = true;
  });

  win.webContents.on("will-navigate", (e, url) => {
    if (!initialLoadDone) return; // Allow the initial file:// load

    e.preventDefault();

    // Open http(s) URLs in external browser
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    // All other navigations (file://, about:, anchors, etc.) are silently blocked
  });

  // Prevent new windows from opening inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block mouse back/forward buttons — prevent history navigation
  win.webContents.on("before-input-event", (_e, input) => {
    // Mouse back/forward (BrowserBack/BrowserForward) or Alt+Left/Right
    if (input.key === "BrowserBack" || input.key === "BrowserForward") {
      _e.preventDefault();
    }
    if ((input.alt || input.meta) && (input.key === "Left" || input.key === "Right")) {
      _e.preventDefault();
    }
  });

  createMenu(win);

  // Initialize IPC handlers, session manager, etc. (once globally)
  if (!ipcRegistered) {
    registerIpcHandlers();
    initSessionManager();
    initAutosaveManager();

    // IPC: get current locale for renderer
    ipcMain.handle("i18n:getLocale", () => getLocale());
    ipcMain.handle("i18n:getSupportedLocales", () => getSupportedLocales());
    ipcMain.handle("i18n:setLocale", (_event, locale) => {
      setLocale(locale);
      // Rebuild menu with new locale (menu is app-global, no specific window needed)
      createMenu(null);
    });

    // IPC: get window ID for this renderer (used for session/autosave isolation)
    ipcMain.handle("window:getWindowId", (event) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      return w ? w.__mdpadWindowId : 0;
    });

    // IPC: session save (called periodically from renderer)
    ipcMain.handle("session:save", (event, sessionData) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      const wid = w ? w.__mdpadWindowId : 0;
      saveSession(sessionData, wid);
    });

    // IPC: get session data for recovery
    ipcMain.handle("session:getRecovery", () => {
      return loadRecoverySessions();
    });

    // IPC: clear session after successful save/close
    ipcMain.handle("session:clear", (event) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      const wid = w ? w.__mdpadWindowId : 0;
      clearSessionForWindow(wid);
    });

    // IPC: autosave
    ipcMain.handle("autosave:getMinutes", () => getAutosaveMinutes());
    ipcMain.handle("autosave:setMinutes", (_event, minutes) => {
      setAutosaveMinutes(minutes);
      // Rebuild menu with new autosave setting (menu is app-global)
      createMenu(null);
    });
    ipcMain.handle("autosave:save", (event, data) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      const wid = w ? w.__mdpadWindowId : 0;
      saveAutosaveBackup(data, wid);
    });
    ipcMain.handle("autosave:clear", (event) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      const wid = w ? w.__mdpadWindowId : 0;
      clearAutosaveForWindow(wid);
    });
    ipcMain.handle("autosave:resumeSave", (event, data) => {
      const w = BrowserWindow.fromWebContents(event.sender);
      const wid = w ? w.__mdpadWindowId : 0;
      saveResumeBackup(data, wid);
    });
    ipcMain.handle("autosave:getOrphaned", () => {
      return loadOrphanedAutosaves();
    });
    ipcMain.handle("autosave:removeOrphaned", (_event, backupFilePath) => {
      removeOrphanedBackup(backupFilePath);
    });

    // IPC: open file in a new window (same process, different BrowserWindow)
    ipcMain.handle("drop:openInNewWindow", (_event, filePath) => {
      createWindow(filePath);
    });

    // IPC: open a new empty window (same process)
    ipcMain.handle("window:newWindow", () => {
      createWindow(null);
    });

    // IPC: open URL in external browser
    ipcMain.handle("shell:openExternal", (_event, url) => {
      // Only allow http/https URLs for safety
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    });

    // IPC: get app version info for About dialog
    ipcMain.handle("app:getVersionInfo", () => {
      const pkg = require("../../package.json");
      let buildNumber = 1;
      try {
        const buildFile = path.join(__dirname, "..", "..", "build-number.json");
        const buildData = JSON.parse(fs.readFileSync(buildFile, "utf-8"));
        buildNumber = buildData.build || 1;
      } catch {
        // build-number.json not found — use default
      }
      const [major, minor] = pkg.version.split(".");
      return {
        major: parseInt(major, 10),
        minor: parseInt(minor, 10),
        build: buildNumber,
        version: `v${major}.${minor}.${String(buildNumber).padStart(5, "0")}`,
      };
    });

    ipcRegistered = true;
  }

  // Track the first window as mainWindow
  if (!mainWindow) {
    mainWindow = win;
  }

  return win;
}

function clearSessionForWindow(windowId) {
  try {
    const sessionDir = getSessionDir();
    const sessionFile = path.join(sessionDir, `session-${process.pid}-${windowId}.json`);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

function clearAutosaveForWindow(windowId) {
  try {
    const dir = getAutosaveDir();
    const backupFile = path.join(dir, `autosave-${process.pid}-${windowId}.json`);
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

function loadRecoverySessions() {
  try {
    const sessionDir = getSessionDir();
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir);
    const sessions = [];

    for (const file of files) {
      if (!file.startsWith("session-") || !file.endsWith(".json")) continue;

      // Parse PID from filename: session-PID.json or session-PID-WID.json
      const stem = file.replace("session-", "").replace(".json", "");
      const pid = parseInt(stem.split("-")[0], 10);
      if (isNaN(pid)) continue;

      // Skip our own session files
      if (pid === process.pid) continue;

      // Check if that process is still running
      if (isProcessRunning(pid)) continue;

      // Orphaned session — load it
      const filePath = path.join(sessionDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        data._sessionFile = filePath;
        sessions.push(data);
      } catch {
        // Corrupted session file — remove it
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    return sessions;
  } catch {
    return [];
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a separate mdpad process (independent instance).
 * If filePath is provided, pass it as a command-line argument.
 */
function spawnNewInstance(filePath) {
  const { spawn } = require("child_process");
  const exePath = app.getPath("exe");

  // In dev mode (electron .), exe points to electron.exe — need to add "." arg
  const isDevMode = !app.isPackaged;
  const baseArgs = isDevMode ? ["."] : [];
  const args = filePath
    ? [...baseArgs, "--", filePath]
    : baseArgs;

  spawn(exePath, args, {
    detached: true,
    stdio: "ignore",
    cwd: isDevMode ? path.join(__dirname, "..", "..") : undefined,
  }).unref();
}

// Handle command-line file argument (from spawned instance or OS file association)
function getFileArgFromCommandLine() {
  const args = process.argv;

  // Look for file path after "--" separator (used by spawnNewInstance)
  const dashIdx = args.indexOf("--");
  if (dashIdx !== -1 && args.length > dashIdx + 1) {
    const filePath = args[dashIdx + 1];
    if (fs.existsSync(filePath)) return filePath;
  }

  // Also check last argument (for OS-level file association, e.g. double-click .md)
  // Skip if there's only 1 arg (the exe itself) or 2 args in dev mode (electron + .)
  if (args.length <= 1) return null;

  const last = args[args.length - 1];
  if (!last || last.startsWith("-") || last === "." || last === "/?") return null;

  // Ignore executable files (the app's own EXE or electron.exe)
  const ext = path.extname(last).toLowerCase();
  if (ext === ".exe" || ext === ".lnk") return null;

  if (fs.existsSync(last)) return last;
  return null;
}

/**
 * Parse --panes= and --view= CLI options for pane layout.
 * --panes takes precedence over --view.
 * Returns pane config object or null (use smart default).
 */
function parsePaneArgs(argv) {
  let paneConfig = null;
  for (const arg of argv) {
    if (arg.startsWith("--panes=")) {
      const panes = arg.slice(8).split(",").map((s) => s.trim().toLowerCase());
      paneConfig = {
        editor: panes.includes("editor"),
        preview: panes.includes("preview"),
        diff: panes.includes("diff"),
      };
      // Ensure at least one pane is enabled
      if (!paneConfig.editor && !paneConfig.preview && !paneConfig.diff) {
        paneConfig.preview = true;
      }
    }
    if (arg.startsWith("--view=") && !paneConfig) {
      const view = arg.slice(7).toLowerCase();
      const map = {
        "preview": { editor: false, preview: true, diff: false },
        "editor": { editor: true, preview: false, diff: false },
        "diff": { editor: false, preview: false, diff: true },
        "editor+preview": { editor: true, preview: true, diff: false },
        "all": { editor: true, preview: true, diff: true },
      };
      paneConfig = map[view] || null;
    }
  }
  return paneConfig;
}

// --- CLI: --help / -h / /? / --version / -v ---
{
  const pkg = require("../../package.json");
  const cliArgs = process.argv.slice(1); // skip the exe/electron itself

  const hasHelp = cliArgs.some((a) => a === "--help" || a === "-h" || a === "/?");
  const hasVersion = cliArgs.some((a) => a === "--version" || a === "-v");

  if (hasHelp) {
    console.log(`${pkg.name} v${pkg.version}`);
    console.log(`${pkg.description}\n`);
    console.log("Usage:");
    console.log("  mdpad [options] [file]");
    console.log("");
    console.log("Options:");
    console.log("  --help, -h, /?     Show this help and exit");
    console.log("  --version, -v      Show version and exit");
    console.log("  --panes=LIST       Panes to show (comma-separated: editor,preview,diff)");
    console.log("  --view=MODE        Layout preset (preview|editor|diff|editor+preview|all)");
    console.log("");
    console.log("  --panes takes precedence over --view. Without either, the app uses");
    console.log("  git-aware smart defaults when opening a file externally.");
    console.log("");
    console.log("Arguments:");
    console.log("  file               Markdown file to open (.md, .txt, etc.)");
    console.log("");
    console.log("Examples:");
    console.log("  mdpad README.md");
    console.log("  mdpad --view=preview README.md");
    console.log("  mdpad --panes=editor,preview README.md");
    console.log("  mdpad --help");
    process.exit(0);
  }

  if (hasVersion) {
    console.log(`${pkg.name} v${pkg.version}`);
    process.exit(0);
  }
}

// Attempt single-instance lock. If another instance is already running,
// send the file argument to it and quit this one.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is running — it will handle the second-instance event.
  app.quit();
} else {
  // We are the primary instance.
  // When a second instance is launched, open a new window in THIS process.
  app.on("second-instance", (_event, argv) => {
    // Extract file path from the new instance's argv
    let filePath = null;
    const dashIdx = argv.indexOf("--");
    if (dashIdx !== -1 && argv.length > dashIdx + 1) {
      const candidate = argv[dashIdx + 1];
      if (fs.existsSync(candidate)) filePath = candidate;
    }
    if (!filePath) {
      const last = argv[argv.length - 1];
      if (last && !last.startsWith("-") && last !== "." && last !== "/?" &&
          ![".exe", ".lnk"].includes(path.extname(last).toLowerCase()) &&
          fs.existsSync(last)) {
        filePath = last;
      }
    }

    // Parse pane layout args from second instance's argv
    const paneConfig = parsePaneArgs(argv);

    // Create a new window in this process
    createWindow(filePath, paneConfig);
  });

  app.whenReady().then(() => {
    const openFilePath = getFileArgFromCommandLine();
    const paneConfig = parsePaneArgs(process.argv);
    createWindow(openFilePath, paneConfig);
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle OS-level force quit (e.g. Ctrl+C, SIGTERM)
app.on("before-quit", () => {
  forceQuit = true;
  stopAllWatchers();
});
