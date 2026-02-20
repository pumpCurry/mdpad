const { ipcMain, dialog, BrowserWindow } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { addRecentFile, getRecentFiles } = require("./recent-files");
const { t } = require("../i18n/i18n-main");

let registered = false;

/**
 * Register IPC handlers (once globally).
 * All dialog calls use BrowserWindow.fromWebContents(event.sender)
 * so they work correctly with multiple windows.
 */
function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle("file:open", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        { name: t("dialog.filterMarkdown"), extensions: ["md", "markdown", "mdown", "mkd"] },
        { name: t("dialog.filterText"), extensions: ["txt"] },
        { name: t("dialog.filterAll"), extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    addRecentFile(filePath);
    return { path: filePath, content };
  });

  ipcMain.handle("file:openByPath", async (_event, filePath) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      addRecentFile(filePath);
      return { path: filePath, content };
    } catch {
      return null;
    }
  });

  ipcMain.handle("file:save", async (_event, filePath, content) => {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle("file:saveAs", async (event, content) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      filters: [
        { name: t("dialog.filterMarkdown"), extensions: ["md"] },
        { name: t("dialog.filterText"), extensions: ["txt"] },
        { name: t("dialog.filterAll"), extensions: ["*"] },
      ],
    });
    if (result.canceled) return null;
    await fs.writeFile(result.filePath, content, "utf-8");
    addRecentFile(result.filePath);
    return { path: result.filePath };
  });

  ipcMain.handle("file:getRecent", () => {
    return getRecentFiles();
  });

  ipcMain.handle("diff:openFile", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        { name: t("dialog.filterMarkdown"), extensions: ["md", "markdown", "mdown", "mkd"] },
        { name: t("dialog.filterText"), extensions: ["txt"] },
        { name: t("dialog.filterAll"), extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    return { path: filePath, content };
  });

  ipcMain.handle("window:setTitle", (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setTitle(title);
  });
}

module.exports = { registerIpcHandlers };
