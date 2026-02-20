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
  clearAutosaveBackup,
  loadOrphanedAutosaves,
  removeOrphanedBackup,
} = require("./autosave-manager");

let mainWindow = null;
let forceQuit = false;
let ipcRegistered = false; // IPC handlers registered once globally

function createWindow(openFilePath) {
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

  if (bounds.isMaximized) {
    win.maximize();
  }

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // If a file path was passed, send it to renderer after load
  if (openFilePath) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("menu:action", "dropOpenFile:" + openFilePath);
    });
  }

  // Per-window forceQuit flag
  let windowForceQuit = false;

  // Close dialog result handler (renderer → main)
  // Each window gets its own resolver
  let closeDialogResolve = null;

  ipcMain.on("close:dialogResult", (event, result) => {
    // Only handle events from this window's webContents
    if (event.sender === win.webContents && closeDialogResolve) {
      closeDialogResolve(result);
      closeDialogResolve = null;
    }
  });

  // Close handler: intercept and ask renderer for dirty state
  win.on("close", async (e) => {
    saveWindowState(win);

    if (forceQuit || windowForceQuit) return; // Already confirmed, let it close

    e.preventDefault();

    try {
      // Ask renderer: are you dirty? do you have a file path?
      const state = await win.webContents.executeJavaScript(
        `window.__mdpadGetCloseState ? window.__mdpadGetCloseState() : { isDirty: false, hasFilePath: false, filePath: null }`
      );

      if (!state.isDirty) {
        // Clean — close immediately, clear session + autosave
        windowForceQuit = true;
        clearSession();
        clearAutosaveBackup();
        win.close();
        return;
      }

      // Dirty — send to renderer to show HTML close dialog
      const resultPromise = new Promise((resolve) => {
        closeDialogResolve = resolve;
      });

      win.webContents.send("close:showDialog", {
        isDirty: state.isDirty,
        hasFilePath: state.hasFilePath,
        filePath: state.filePath,
      });

      const result = await resultPromise;

      if (result === "save") {
        // Overwrite save (existing file)
        const content = await win.webContents.executeJavaScript(
          `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
        );
        fs.writeFileSync(state.filePath, content, "utf-8");
        windowForceQuit = true;
        clearSession();
        clearAutosaveBackup();
        win.close();
      } else if (result === "saveAs") {
        // Save As dialog
        const saveResult = await dialog.showSaveDialog(win, {
          filters: [
            { name: t("dialog.filterMarkdown"), extensions: ["md"] },
            { name: t("dialog.filterText"), extensions: ["txt"] },
            { name: t("dialog.filterAll"), extensions: ["*"] },
          ],
        });
        if (!saveResult.canceled) {
          const content = await win.webContents.executeJavaScript(
            `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
          );
          fs.writeFileSync(saveResult.filePath, content, "utf-8");
          windowForceQuit = true;
          clearSession();
          clearAutosaveBackup();
          win.close();
        }
        // If canceled, stay open
      } else if (result === "resumeSave") {
        // Resume save: force backup then close
        const content = await win.webContents.executeJavaScript(
          `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
        );
        saveResumeBackup({
          content,
          filePath: state.filePath,
          originalContent: "",
          isDirty: true,
        });
        windowForceQuit = true;
        clearSession();
        win.close();
      } else if (result === "exitNoSave") {
        // Exit without saving
        windowForceQuit = true;
        clearSession();
        clearAutosaveBackup();
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
  registerIpcHandlers(win);

  // Initialize session manager for crash recovery (once)
  if (!ipcRegistered) {
    initSessionManager();
    initAutosaveManager();

    // IPC: get current locale for renderer
    ipcMain.handle("i18n:getLocale", () => getLocale());
    ipcMain.handle("i18n:getSupportedLocales", () => getSupportedLocales());
    ipcMain.handle("i18n:setLocale", (_event, locale) => {
      setLocale(locale);
      // Rebuild menu for all windows
      for (const w of BrowserWindow.getAllWindows()) {
        createMenu(w);
      }
    });

    // IPC: session save (called periodically from renderer)
    ipcMain.handle("session:save", (_event, sessionData) => {
      saveSession(sessionData);
    });

    // IPC: get session data for recovery
    ipcMain.handle("session:getRecovery", () => {
      return loadRecoverySessions();
    });

    // IPC: clear session after successful save/close
    ipcMain.handle("session:clear", () => {
      clearSession();
    });

    // IPC: autosave
    ipcMain.handle("autosave:getMinutes", () => getAutosaveMinutes());
    ipcMain.handle("autosave:setMinutes", (_event, minutes) => {
      setAutosaveMinutes(minutes);
      // Rebuild menu for all windows
      for (const w of BrowserWindow.getAllWindows()) {
        createMenu(w);
      }
    });
    ipcMain.handle("autosave:save", (_event, data) => {
      saveAutosaveBackup(data);
    });
    ipcMain.handle("autosave:clear", () => {
      clearAutosaveBackup();
    });
    ipcMain.handle("autosave:resumeSave", (_event, data) => {
      saveResumeBackup(data);
    });
    ipcMain.handle("autosave:getOrphaned", () => {
      return loadOrphanedAutosaves();
    });
    ipcMain.handle("autosave:removeOrphaned", (_event, backupFilePath) => {
      removeOrphanedBackup(backupFilePath);
    });

    // IPC: open file in a separate process (independent instance)
    ipcMain.handle("drop:openInNewWindow", (_event, filePath) => {
      spawnNewInstance(filePath);
    });

    // IPC: open a new empty window (separate process)
    ipcMain.handle("window:newWindow", () => {
      spawnNewInstance(null);
    });

    // IPC: open URL in external browser
    ipcMain.handle("shell:openExternal", (_event, url) => {
      // Only allow http/https URLs for safety
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    });

    ipcRegistered = true;
  }

  // Track the first window as mainWindow
  if (!mainWindow) {
    mainWindow = win;
  }

  return win;
}

function clearSession() {
  try {
    const sessionDir = getSessionDir();
    const sessionFile = path.join(sessionDir, `session-${process.pid}.json`);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
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

      // Extract PID from filename
      const pidStr = file.replace("session-", "").replace(".json", "");
      const pid = parseInt(pidStr, 10);

      // Skip our own session file
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
  const args = filePath ? ["--", filePath] : [];
  spawn(exePath, args, {
    detached: true,
    stdio: "ignore",
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
    console.log("");
    console.log("Arguments:");
    console.log("  file               Markdown file to open (.md, .txt, etc.)");
    console.log("");
    console.log("Examples:");
    console.log("  mdpad README.md");
    console.log("  mdpad --help");
    process.exit(0);
  }

  if (hasVersion) {
    console.log(`${pkg.name} v${pkg.version}`);
    process.exit(0);
  }
}

app.whenReady().then(() => {
  const openFilePath = getFileArgFromCommandLine();
  createWindow(openFilePath);
});

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
});
