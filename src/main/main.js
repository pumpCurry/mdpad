const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { registerIpcHandlers } = require("./ipc-handlers");
const { createMenu } = require("./menu");
const { restoreWindowState, saveWindowState } = require("./window-state");
const { initLocale, getLocale, setLocale, getSupportedLocales } = require("../i18n/i18n-main");

let mainWindow = null;

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

  mainWindow.on("close", (e) => {
    saveWindowState(mainWindow);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createMenu(mainWindow);
  registerIpcHandlers(mainWindow);

  // IPC: get current locale for renderer
  ipcMain.handle("i18n:getLocale", () => getLocale());
  ipcMain.handle("i18n:getSupportedLocales", () => getSupportedLocales());
  ipcMain.handle("i18n:setLocale", (_event, locale) => {
    setLocale(locale);
    // Rebuild menu with new locale
    createMenu(mainWindow);
  });
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
