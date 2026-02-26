const { Menu, BrowserWindow } = require("electron");
const { t, getLocale, setLocale, getSupportedLocales } = require("../i18n/i18n-main");
const { getAutosaveMinutes } = require("./autosave-manager");
const { getFileWatchEnabled, getAutoReloadEnabled } = require("./file-watch-settings");

const localeLabels = {
  en: "English",
  ja: "日本語",
};

/**
 * Get the window that should receive menu actions.
 * Uses the focused window first, then falls back to the first available window.
 * Returns null if no valid window exists.
 */
function getTargetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows();
  for (const w of all) {
    if (!w.isDestroyed()) return w;
  }
  return null;
}

/**
 * Safely send an IPC message to the target window.
 * No-op if no valid window is available.
 */
function sendToTarget(channel, ...args) {
  const win = getTargetWindow();
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function createMenu(_mainWindow) {
  const currentLocale = getLocale();
  const currentAutosave = getAutosaveMinutes();
  const currentFileWatch = getFileWatchEnabled();
  const currentAutoReload = getAutoReloadEnabled();

  // Build language submenu
  const langSubmenu = getSupportedLocales().map((loc) => ({
    label: localeLabels[loc] || loc,
    type: "radio",
    checked: loc === currentLocale,
    click: () => {
      setLocale(loc);
      createMenu(null); // Rebuild menu (no specific window needed)
      // Notify ALL windows about locale change
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
          w.webContents.send("menu:action", "changeLocale:" + loc);
        }
      }
    },
  }));

  // Build autosave submenu: OFF, 1, 2, 3, 5, 10, 15, 30, 60 min
  const autosaveOptions = [0, 1, 2, 3, 5, 10, 15, 30, 60];
  const autosaveSubmenu = autosaveOptions.map((min) => ({
    label: min === 0 ? t("menu.autosave_off") : `${min} ${t("menu.autosave_min")}`,
    type: "radio",
    checked: currentAutosave === min,
    click: () => {
      sendToTarget("menu:action", "setAutosave:" + min);
    },
  }));

  const template = [
    {
      label: t("menu.file"),
      submenu: [
        {
          label: t("menu.file_new"),
          accelerator: "CmdOrCtrl+N",
          click: () => sendToTarget("menu:action", "new"),
        },
        {
          label: t("menu.file_newWindow"),
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => sendToTarget("menu:action", "newWindow"),
        },
        {
          label: t("menu.file_open"),
          accelerator: "CmdOrCtrl+O",
          click: () => sendToTarget("menu:action", "open"),
        },
        {
          label: t("menu.file_reload"),
          accelerator: "F5",
          click: () => sendToTarget("menu:action", "reload"),
        },
        { type: "separator" },
        {
          label: t("menu.file_save"),
          accelerator: "CmdOrCtrl+S",
          click: () => sendToTarget("menu:action", "save"),
        },
        {
          label: t("menu.file_saveAs"),
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendToTarget("menu:action", "saveAs"),
        },
        { type: "separator" },
        {
          label: t("menu.file_autosave"),
          submenu: autosaveSubmenu,
        },
        {
          label: t("menu.file_fileWatch"),
          type: "checkbox",
          checked: currentFileWatch,
          click: (menuItem) => {
            sendToTarget("menu:action", "setFileWatch:" + (menuItem.checked ? "1" : "0"));
          },
        },
        {
          label: t("menu.file_autoReload"),
          type: "checkbox",
          checked: currentAutoReload,
          click: (menuItem) => {
            sendToTarget("menu:action", "setAutoReload:" + (menuItem.checked ? "1" : "0"));
          },
        },
        {
          label: t("menu.file_restoreBackup"),
          click: () => sendToTarget("menu:action", "restoreBackup"),
        },
        {
          label: t("menu.file_properties"),
          click: () => sendToTarget("menu:action", "properties"),
        },
        { type: "separator" },
        {
          label: t("menu.file_exit"),
          accelerator: "Alt+F4",
          click: () => {
            const win = getTargetWindow();
            if (win) win.close();
          },
        },
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [
        {
          label: t("menu.edit_undo"),
          accelerator: "CmdOrCtrl+Z",
          click: () => sendToTarget("menu:action", "undo"),
        },
        {
          label: t("menu.edit_redo"),
          accelerator: "CmdOrCtrl+Y",
          click: () => sendToTarget("menu:action", "redo"),
        },
        { type: "separator" },
        { role: "cut", label: t("menu.edit_cut") },
        { role: "copy", label: t("menu.edit_copy") },
        { role: "paste", label: t("menu.edit_paste") },
        { role: "selectAll", label: t("menu.edit_selectAll") },
        { type: "separator" },
        {
          label: t("menu.edit_find"),
          accelerator: "CmdOrCtrl+F",
          click: () => sendToTarget("menu:action", "find"),
        },
        {
          label: t("menu.edit_replace"),
          accelerator: "CmdOrCtrl+H",
          click: () => sendToTarget("menu:action", "replace"),
        },
        { type: "separator" },
        {
          label: t("menu.edit_goToLine"),
          accelerator: "CmdOrCtrl+G",
          click: () => sendToTarget("menu:action", "goToLine"),
        },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        {
          label: t("menu.view_toggleEditor"),
          accelerator: "CmdOrCtrl+1",
          click: () => sendToTarget("menu:action", "toggleEditor"),
        },
        {
          label: t("menu.view_togglePreview"),
          accelerator: "CmdOrCtrl+2",
          click: () => sendToTarget("menu:action", "togglePreview"),
        },
        {
          label: t("menu.view_toggleDiff"),
          accelerator: "CmdOrCtrl+3",
          click: () => sendToTarget("menu:action", "toggleDiff"),
        },
        { type: "separator" },
        {
          label: t("menu.view_toggleWordWrap"),
          accelerator: "Alt+Z",
          click: () => sendToTarget("menu:action", "toggleWordWrap"),
        },
        {
          label: t("menu.view_toggleCloseBrackets"),
          type: "checkbox",
          checked: true,
          click: (menuItem) =>
            sendToTarget("menu:action", "toggleCloseBrackets"),
        },
        { type: "separator" },
        {
          label: t("menu.view_zoomIn"),
          accelerator: "CmdOrCtrl+=",
          role: "zoomIn",
        },
        {
          label: t("menu.view_zoomOut"),
          accelerator: "CmdOrCtrl+-",
          role: "zoomOut",
        },
        {
          label: t("menu.view_resetZoom"),
          accelerator: "CmdOrCtrl+0",
          role: "resetZoom",
        },
        { type: "separator" },
        {
          label: t("menu.view_language"),
          submenu: langSubmenu,
        },
        { type: "separator" },
        {
          label: t("menu.view_devTools"),
          accelerator: "F12",
          click: () => {
            const win = getTargetWindow();
            if (win) win.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: t("menu.help"),
      submenu: [
        {
          label: t("menu.help_about"),
          click: () => sendToTarget("menu:action", "about"),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { createMenu };
