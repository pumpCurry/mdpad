const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mdpad", {
  // File operations
  openFile: () => ipcRenderer.invoke("file:open"),
  openFileByPath: (filePath) => ipcRenderer.invoke("file:openByPath", filePath),
  saveFile: (filePath, content) =>
    ipcRenderer.invoke("file:save", filePath, content),
  saveFileAs: (content) => ipcRenderer.invoke("file:saveAs", content),
  getRecentFiles: () => ipcRenderer.invoke("file:getRecent"),

  // Diff
  openDiffFile: () => ipcRenderer.invoke("diff:openFile"),

  // Window
  setTitle: (title) => ipcRenderer.invoke("window:setTitle", title),
  confirmSave: () => ipcRenderer.invoke("dialog:confirmSave"),

  // i18n
  getLocale: () => ipcRenderer.invoke("i18n:getLocale"),
  getSupportedLocales: () => ipcRenderer.invoke("i18n:getSupportedLocales"),
  setLocale: (locale) => ipcRenderer.invoke("i18n:setLocale", locale),

  // Session (crash recovery)
  saveSession: (data) => ipcRenderer.invoke("session:save", data),
  getRecoverySessions: () => ipcRenderer.invoke("session:getRecovery"),
  clearSession: () => ipcRenderer.invoke("session:clear"),

  // Autosave (backup)
  getAutosaveMinutes: () => ipcRenderer.invoke("autosave:getMinutes"),
  setAutosaveMinutes: (minutes) => ipcRenderer.invoke("autosave:setMinutes", minutes),
  saveAutosaveBackup: (data) => ipcRenderer.invoke("autosave:save", data),
  clearAutosaveBackup: () => ipcRenderer.invoke("autosave:clear"),
  getOrphanedAutosaves: () => ipcRenderer.invoke("autosave:getOrphaned"),
  removeOrphanedBackup: (path) => ipcRenderer.invoke("autosave:removeOrphaned", path),

  // Menu actions (main -> renderer)
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
});
