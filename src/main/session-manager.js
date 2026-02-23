/**
 * Session manager for crash recovery.
 * Saves editor state to a per-PID file in userData/sessions/.
 * On startup, checks for orphaned session files from crashed processes.
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let sessionDir = null;

function getSessionDir() {
  if (!sessionDir) {
    sessionDir = path.join(app.getPath("userData"), "sessions");
  }
  return sessionDir;
}

function initSessionManager() {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save current session state to a PID+windowId-specific file.
 * @param {Object} data - { content, filePath, isDirty, paneState, timestamp }
 * @param {number} windowId - Unique window ID for multi-window isolation
 */
function saveSession(data, windowId) {
  try {
    const dir = getSessionDir();
    const sessionFile = path.join(dir, `session-${process.pid}-${windowId || 0}.json`);
    const sessionData = {
      ...data,
      pid: process.pid,
      windowId: windowId || 0,
      savedAt: Date.now(),
    };
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData), "utf-8");
  } catch {
    // Ignore write errors
  }
}

module.exports = { initSessionManager, saveSession, getSessionDir };
