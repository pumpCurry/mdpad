const { contextBridge, ipcRenderer, webUtils, webFrame } = require("electron");

contextBridge.exposeInMainWorld("mdpad", {
  // File operations
  openFile: () => ipcRenderer.invoke("file:open"),
  openFileByPath: (filePath) => ipcRenderer.invoke("file:openByPath", filePath),
  saveFile: (filePath, content) =>
    ipcRenderer.invoke("file:save", filePath, content),
  saveFileAs: (content, filePath) => ipcRenderer.invoke("file:saveAs", content, filePath),
  getRecentFiles: () => ipcRenderer.invoke("file:getRecent"),

  // Diff
  openDiffFile: () => ipcRenderer.invoke("diff:openFile"),

  // Git
  getGitInfo: (filePath) => ipcRenderer.invoke("git:getInfo", filePath),
  getGitFileContent: (filePath) => ipcRenderer.invoke("git:getFileContent", filePath),
  getDetailedGitInfo: (filePath) => ipcRenderer.invoke("git:getDetailedInfo", filePath),
  invalidateGitCache: (filePath) => ipcRenderer.invoke("git:invalidateCache", filePath),

  // File properties
  getFileProperties: (filePath) => ipcRenderer.invoke("file:getProperties", filePath),

  // Window
  setTitle: (title) => ipcRenderer.invoke("window:setTitle", title),
  getWindowId: () => ipcRenderer.invoke("window:getWindowId"),

  // Zoom level (webFrame)
  getZoomLevel: () => webFrame.getZoomLevel(),

  // App version info
  getVersionInfo: () => ipcRenderer.invoke("app:getVersionInfo"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),

  // i18n
  getLocale: () => ipcRenderer.invoke("i18n:getLocale"),
  getSupportedLocales: () => ipcRenderer.invoke("i18n:getSupportedLocales"),
  setLocale: (locale) => ipcRenderer.invoke("i18n:setLocale", locale),

  // Session (crash recovery)
  saveSession: (data) => ipcRenderer.invoke("session:save", data),
  getRecoverySessions: () => ipcRenderer.invoke("session:getRecovery"),
  clearSession: () => ipcRenderer.invoke("session:clear"),

  // Open file in new instance (separate process)
  openFileInNewWindow: (filePath) => ipcRenderer.invoke("drop:openInNewWindow", filePath),

  // Open a new empty window (separate process)
  newWindow: () => ipcRenderer.invoke("window:newWindow"),

  // Autosave (backup)
  getAutosaveMinutes: () => ipcRenderer.invoke("autosave:getMinutes"),
  setAutosaveMinutes: (minutes) => ipcRenderer.invoke("autosave:setMinutes", minutes),
  saveAutosaveBackup: (data) => ipcRenderer.invoke("autosave:save", data),
  clearAutosaveBackup: () => ipcRenderer.invoke("autosave:clear"),
  getOrphanedAutosaves: () => ipcRenderer.invoke("autosave:getOrphaned"),
  removeOrphanedBackup: (path) => ipcRenderer.invoke("autosave:removeOrphaned", path),

  // File watching
  watchFile: (filePath) => ipcRenderer.invoke("file:watch", filePath),
  unwatchFile: () => ipcRenderer.invoke("file:unwatch"),
  setFileIgnoring: (flag) => ipcRenderer.invoke("file:setIgnoring", flag),
  onFileChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("file:changed", listener);
    return () => ipcRenderer.removeListener("file:changed", listener);
  },

  // File watch settings
  getFileWatchEnabled: () => ipcRenderer.invoke("fileWatch:getEnabled"),
  setFileWatchEnabled: (enabled) => ipcRenderer.invoke("fileWatch:setEnabled", enabled),
  getAutoReloadEnabled: () => ipcRenderer.invoke("fileWatch:getAutoReload"),
  setAutoReloadEnabled: (enabled) => ipcRenderer.invoke("fileWatch:setAutoReload", enabled),

  // ビュー状態同期（書式バーモードをメインプロセスに通知してメニューの checked 状態を同期）
  setFormatBarModeMain: (mode) => ipcRenderer.invoke("viewState:setFormatBarMode", mode),

  // DnD: get file path from File object (Electron 33+ requires webUtils)
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Shell: open URL in external browser
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // Close dialog (main -> renderer -> main)
  onShowCloseDialog: (callback) => {
    const listener = (_event, closeState) => callback(closeState);
    ipcRenderer.on("close:showDialog", listener);
    return () => ipcRenderer.removeListener("close:showDialog", listener);
  },
  sendCloseDialogResult: (result) => ipcRenderer.send("close:dialogResult", result),

  // Resume save (force backup even if autosave is OFF)
  saveResumeBackup: (data) => ipcRenderer.invoke("autosave:resumeSave", data),

  // Menu actions (main -> renderer)
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },

  // Pane config (main -> renderer, for external file open)
  onApplyPaneConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on("apply-pane-config", listener);
    return () => ipcRenderer.removeListener("apply-pane-config", listener);
  },
});
