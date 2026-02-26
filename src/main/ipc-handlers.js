const { ipcMain, dialog, BrowserWindow } = require("electron");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { addRecentFile, getRecentFiles } = require("./recent-files");
const { createMenu } = require("./menu");
const { t, getLocale } = require("../i18n/i18n-main");
const { getGitInfo, getGitFileContent, getDetailedGitInfo, invalidateGitCache } = require("./git-utils");
const { startWatch, stopWatch, setIgnoring } = require("./file-watcher");

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
    if (!win || win.isDestroyed()) return null;
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
    createMenu(null);
    const eol = detectEol(content);
    return { path: filePath, content, eol };
  });

  ipcMain.handle("file:openByPath", async (_event, filePath) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      addRecentFile(filePath);
      createMenu(null);
      const eol = detectEol(content);
      return { path: filePath, content, eol };
    } catch {
      return null;
    }
  });

  ipcMain.handle("file:save", async (_event, filePath, content) => {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle("file:saveAs", async (event, content, filePath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;

    // Build defaultPath for the save dialog
    let defaultPath;
    if (filePath) {
      // Existing file: preset the current path and filename
      defaultPath = filePath;
    } else {
      // New file: suggest a timestamped filename
      defaultPath = generateDefaultFileName();
    }

    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: [
        { name: t("dialog.filterMarkdown"), extensions: ["md"] },
        { name: t("dialog.filterText"), extensions: ["txt"] },
        { name: t("dialog.filterAll"), extensions: ["*"] },
      ],
    });
    if (result.canceled) return null;
    await fs.writeFile(result.filePath, content, "utf-8");
    addRecentFile(result.filePath);
    createMenu(null);
    return { path: result.filePath };
  });

  ipcMain.handle("file:getRecent", () => {
    return getRecentFiles();
  });

  ipcMain.handle("diff:openFile", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
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

  // Git operations
  ipcMain.handle("git:getInfo", async (_event, filePath) => {
    return getGitInfo(filePath);
  });

  ipcMain.handle("git:getFileContent", async (_event, filePath) => {
    return getGitFileContent(filePath);
  });

  ipcMain.handle("git:invalidateCache", async (_event, filePath) => {
    invalidateGitCache(filePath);
  });

  // File properties (stat info for properties dialog)
  ipcMain.handle("file:getProperties", async (_event, filePath) => {
    try {
      const stat = await fs.stat(filePath);
      return {
        size: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        accessed: stat.atime.toISOString(),
      };
    } catch {
      return null;
    }
  });

  // Detailed git info for properties dialog
  ipcMain.handle("git:getDetailedInfo", async (_event, filePath) => {
    return getDetailedGitInfo(filePath);
  });

  // File watching
  ipcMain.handle("file:watch", (event, filePath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const windowId = win.__mdpadWindowId;
    startWatch(windowId, filePath, () => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send("file:changed");
      }
    });
  });

  ipcMain.handle("file:unwatch", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    stopWatch(win.__mdpadWindowId);
  });

  ipcMain.handle("file:setIgnoring", (event, flag) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    setIgnoring(win.__mdpadWindowId, flag);
  });
}

/**
 * Generate a default filename for new (untitled) files.
 * Format: 無題_YYYYMMDD-hhmmss.md (ja) or Untitled_YYYYMMDD-hhmmss.md (en)
 */
function generateDefaultFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const prefix = getLocale() === "ja" ? "無題" : "Untitled";
  return `${prefix}_${timestamp}.md`;
}

/**
 * Detect the line ending type of a string.
 * Returns "CRLF", "LF", "CR", "Mixed", or null (no line endings).
 */
function detectEol(content) {
  if (!content) return null;
  const crlfCount = (content.match(/\r\n/g) || []).length;
  // Remove CRLF to count standalone CR and LF
  const withoutCrlf = content.replace(/\r\n/g, "");
  const crCount = (withoutCrlf.match(/\r/g) || []).length;
  const lfCount = (withoutCrlf.match(/\n/g) || []).length;

  const types = [];
  if (crlfCount > 0) types.push("CRLF");
  if (lfCount > 0) types.push("LF");
  if (crCount > 0) types.push("CR");

  if (types.length === 0) return null;
  if (types.length === 1) return types[0];
  return "Mixed";
}

module.exports = { registerIpcHandlers };
