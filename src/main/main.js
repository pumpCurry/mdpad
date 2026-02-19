const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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
  clearAutosaveBackup,
  loadOrphanedAutosaves,
  removeOrphanedBackup,
} = require("./autosave-manager");

let mainWindow = null;
let forceQuit = false;

function createWindow() {
  // Initialize i18n (detects OS locale or stored preference)
  initLocale();

  const bounds = restoreWindowState();

  mainWindow = new BrowserWindow({
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
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Close handler: intercept and ask renderer for dirty state
  mainWindow.on("close", async (e) => {
    saveWindowState(mainWindow);

    if (forceQuit) return; // Already confirmed, let it close

    e.preventDefault();

    try {
      // Ask renderer: are you dirty? do you have a file path?
      const state = await mainWindow.webContents.executeJavaScript(
        `window.__mdpadGetCloseState ? window.__mdpadGetCloseState() : { isDirty: false, hasFilePath: false, filePath: null }`
      );

      if (!state.isDirty) {
        // Clean — close immediately, clear session + autosave
        forceQuit = true;
        clearSession();
        clearAutosaveBackup();
        mainWindow.close();
        return;
      }

      // Dirty — show save dialog
      let result;
      if (state.hasFilePath) {
        // Existing file: overwrite / save as / exit
        result = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          buttons: [
            t("dialog.closeExistingSave"),
            t("dialog.closeExistingSaveAs"),
            t("dialog.closeExistingExit"),
          ],
          defaultId: 0,
          cancelId: -1,
          message: t("dialog.closeMessage"),
          detail: t("dialog.closeDetail"),
          noLink: true,
        });

        if (result.response === 0) {
          // Overwrite save
          const content = await mainWindow.webContents.executeJavaScript(
            `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
          );
          fs.writeFileSync(state.filePath, content, "utf-8");
          forceQuit = true;
          clearSession();
          clearAutosaveBackup();
          mainWindow.close();
        } else if (result.response === 1) {
          // Save As
          const saveResult = await dialog.showSaveDialog(mainWindow, {
            filters: [
              { name: t("dialog.filterMarkdown"), extensions: ["md"] },
              { name: t("dialog.filterText"), extensions: ["txt"] },
              { name: t("dialog.filterAll"), extensions: ["*"] },
            ],
          });
          if (!saveResult.canceled) {
            const content = await mainWindow.webContents.executeJavaScript(
              `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
            );
            fs.writeFileSync(saveResult.filePath, content, "utf-8");
            forceQuit = true;
            clearSession();
            clearAutosaveBackup();
            mainWindow.close();
          }
          // If canceled, stay open
        } else if (result.response === 2) {
          // Exit without saving
          forceQuit = true;
          clearSession();
          clearAutosaveBackup();
          mainWindow.close();
        }
        // If dialog dismissed (Esc), stay open
      } else {
        // New file: save / exit
        result = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          buttons: [
            t("dialog.closeNewSave"),
            t("dialog.closeNewExit"),
          ],
          defaultId: 0,
          cancelId: -1,
          message: t("dialog.closeMessage"),
          detail: t("dialog.closeDetail"),
          noLink: true,
        });

        if (result.response === 0) {
          // Save (new file → Save As dialog)
          const saveResult = await dialog.showSaveDialog(mainWindow, {
            filters: [
              { name: t("dialog.filterMarkdown"), extensions: ["md"] },
              { name: t("dialog.filterText"), extensions: ["txt"] },
              { name: t("dialog.filterAll"), extensions: ["*"] },
            ],
          });
          if (!saveResult.canceled) {
            const content = await mainWindow.webContents.executeJavaScript(
              `window.__mdpadGetContent ? window.__mdpadGetContent() : ""`
            );
            fs.writeFileSync(saveResult.filePath, content, "utf-8");
            forceQuit = true;
            clearSession();
            clearAutosaveBackup();
            mainWindow.close();
          }
          // If canceled, stay open
        } else if (result.response === 1) {
          // Exit without saving
          forceQuit = true;
          clearSession();
          clearAutosaveBackup();
          mainWindow.close();
        }
        // If dialog dismissed (Esc), stay open
      }
    } catch (err) {
      // If communication fails, allow close
      forceQuit = true;
      mainWindow.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createMenu(mainWindow);
  registerIpcHandlers(mainWindow);

  // Initialize session manager for crash recovery
  initSessionManager();

  // Initialize autosave manager
  initAutosaveManager();

  // IPC: get current locale for renderer
  ipcMain.handle("i18n:getLocale", () => getLocale());
  ipcMain.handle("i18n:getSupportedLocales", () => getSupportedLocales());
  ipcMain.handle("i18n:setLocale", (_event, locale) => {
    setLocale(locale);
    // Rebuild menu with new locale
    createMenu(mainWindow);
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
    // Rebuild menu to update checkmark
    createMenu(mainWindow);
  });
  ipcMain.handle("autosave:save", (_event, data) => {
    saveAutosaveBackup(data);
  });
  ipcMain.handle("autosave:clear", () => {
    clearAutosaveBackup();
  });
  ipcMain.handle("autosave:getOrphaned", () => {
    return loadOrphanedAutosaves();
  });
  ipcMain.handle("autosave:removeOrphaned", (_event, backupFilePath) => {
    removeOrphanedBackup(backupFilePath);
  });
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

app.whenReady().then(createWindow);

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
