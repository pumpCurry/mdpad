const { Menu } = require("electron");
const { t, getLocale, setLocale, getSupportedLocales } = require("../i18n/i18n-main");
const { getAutosaveMinutes } = require("./autosave-manager");

const localeLabels = {
  en: "English",
  ja: "日本語",
};

function createMenu(mainWindow) {
  const currentLocale = getLocale();
  const currentAutosave = getAutosaveMinutes();

  // Build language submenu
  const langSubmenu = getSupportedLocales().map((loc) => ({
    label: localeLabels[loc] || loc,
    type: "radio",
    checked: loc === currentLocale,
    click: () => {
      setLocale(loc);
      createMenu(mainWindow); // Rebuild menu
      mainWindow.webContents.send("menu:action", "changeLocale:" + loc);
    },
  }));

  // Build autosave submenu: OFF, 1, 2, 3, 5, 10, 15, 30, 60 min
  const autosaveOptions = [0, 1, 2, 3, 5, 10, 15, 30, 60];
  const autosaveSubmenu = autosaveOptions.map((min) => ({
    label: min === 0 ? t("menu.autosave_off") : `${min} ${t("menu.autosave_min")}`,
    type: "radio",
    checked: currentAutosave === min,
    click: () => {
      mainWindow.webContents.send("menu:action", "setAutosave:" + min);
    },
  }));

  const template = [
    {
      label: t("menu.file"),
      submenu: [
        {
          label: t("menu.file_new"),
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow.webContents.send("menu:action", "new"),
        },
        {
          label: t("menu.file_open"),
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow.webContents.send("menu:action", "open"),
        },
        { type: "separator" },
        {
          label: t("menu.file_save"),
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow.webContents.send("menu:action", "save"),
        },
        {
          label: t("menu.file_saveAs"),
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => mainWindow.webContents.send("menu:action", "saveAs"),
        },
        { type: "separator" },
        {
          label: t("menu.file_autosave"),
          submenu: autosaveSubmenu,
        },
        { type: "separator" },
        {
          label: t("menu.file_exit"),
          accelerator: "Alt+F4",
          click: () => mainWindow.close(),
        },
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [
        {
          label: t("menu.edit_undo"),
          accelerator: "CmdOrCtrl+Z",
          click: () => mainWindow.webContents.send("menu:action", "undo"),
        },
        {
          label: t("menu.edit_redo"),
          accelerator: "CmdOrCtrl+Y",
          click: () => mainWindow.webContents.send("menu:action", "redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: t("menu.edit_find"),
          accelerator: "CmdOrCtrl+F",
          click: () => mainWindow.webContents.send("menu:action", "find"),
        },
        {
          label: t("menu.edit_replace"),
          accelerator: "CmdOrCtrl+H",
          click: () => mainWindow.webContents.send("menu:action", "replace"),
        },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        {
          label: t("menu.view_toggleEditor"),
          accelerator: "CmdOrCtrl+1",
          click: () =>
            mainWindow.webContents.send("menu:action", "toggleEditor"),
        },
        {
          label: t("menu.view_togglePreview"),
          accelerator: "CmdOrCtrl+2",
          click: () =>
            mainWindow.webContents.send("menu:action", "togglePreview"),
        },
        {
          label: t("menu.view_toggleDiff"),
          accelerator: "CmdOrCtrl+3",
          click: () =>
            mainWindow.webContents.send("menu:action", "toggleDiff"),
        },
        { type: "separator" },
        {
          label: t("menu.view_toggleWordWrap"),
          accelerator: "Alt+Z",
          click: () =>
            mainWindow.webContents.send("menu:action", "toggleWordWrap"),
        },
        {
          label: t("menu.view_toggleCloseBrackets"),
          type: "checkbox",
          checked: true,
          click: (menuItem) =>
            mainWindow.webContents.send("menu:action", "toggleCloseBrackets"),
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
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: t("menu.help"),
      submenu: [
        {
          label: t("menu.help_about"),
          click: () => mainWindow.webContents.send("menu:action", "about"),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { createMenu };
