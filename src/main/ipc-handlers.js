const { ipcMain, dialog } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { addRecentFile, getRecentFiles } = require("./recent-files");
const { t } = require("../i18n/i18n-main");

function registerIpcHandlers(mainWindow) {
  ipcMain.handle("file:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

  ipcMain.handle("file:saveAs", async (_event, content) => {
    const result = await dialog.showSaveDialog(mainWindow, {
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

  ipcMain.handle("diff:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

  ipcMain.handle("window:setTitle", (_event, title) => {
    if (mainWindow) mainWindow.setTitle(title);
  });

  ipcMain.handle("dialog:confirmSave", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: [t("dialog.saveConfirmTitle"), t("dialog.saveConfirmDontSave"), t("dialog.saveConfirmCancel")],
      defaultId: 0,
      cancelId: 2,
      message: t("dialog.saveConfirmMessage"),
      detail: t("dialog.saveConfirmDetail"),
    });
    return result.response;
  });
}

module.exports = { registerIpcHandlers };
