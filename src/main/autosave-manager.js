/**
 * Autosave manager for mdpad.
 * Periodically saves editor content to a temp backup file in userData/autosave/.
 * - Timer is configurable in 1-minute increments (1-60 min) or OFF (0).
 * - Backup is saved to a temp location, NOT overwriting the original file
 *   (because diff depends on original content).
 * - Each instance uses a PID-based backup file.
 * - On startup, orphaned backups from crashed processes are detected.
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let autosaveDir = null;
let autosaveInterval = null;
let autosaveMinutes = 0; // 0 = OFF

// Config key in mdpad-config.json
const CONFIG_KEY = "autosaveMinutes";
const DEFAULT_MINUTES = 5; // Default: 5 minutes

function getAutosaveDir() {
  if (!autosaveDir) {
    autosaveDir = path.join(app.getPath("userData"), "autosave");
  }
  return autosaveDir;
}

function initAutosaveManager() {
  const dir = getAutosaveDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Load saved preference
  autosaveMinutes = loadAutosaveMinutes();
}

/**
 * Load autosave interval from config.
 */
function loadAutosaveMinutes() {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (typeof config[CONFIG_KEY] === "number" && config[CONFIG_KEY] >= 0 && config[CONFIG_KEY] <= 60) {
      return config[CONFIG_KEY];
    }
  } catch {
    // no config
  }
  return DEFAULT_MINUTES;
}

/**
 * Save autosave interval to config.
 */
function saveAutosaveMinutes(minutes) {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // empty
  }
  config[CONFIG_KEY] = minutes;
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

/**
 * Get current autosave interval in minutes (0 = OFF).
 */
function getAutosaveMinutes() {
  return autosaveMinutes;
}

/**
 * Set autosave interval in minutes.
 * 0 = OFF, 1-60 = interval in minutes.
 */
function setAutosaveMinutes(minutes) {
  minutes = Math.max(0, Math.min(60, Math.round(minutes)));
  autosaveMinutes = minutes;
  saveAutosaveMinutes(minutes);
}

/**
 * Save a backup of the current editor state.
 * Called from the renderer via IPC.
 * @param {Object} data - { content, filePath, originalContent, isDirty, timestamp }
 */
function saveAutosaveBackup(data) {
  if (autosaveMinutes === 0) return; // Autosave is OFF

  try {
    const dir = getAutosaveDir();
    const backupFile = path.join(dir, `autosave-${process.pid}.json`);
    const backupData = {
      content: data.content,
      filePath: data.filePath || null,
      originalContent: data.originalContent || "",
      isDirty: data.isDirty,
      pid: process.pid,
      savedAt: Date.now(),
    };
    fs.writeFileSync(backupFile, JSON.stringify(backupData), "utf-8");
  } catch {
    // Ignore write errors
  }
}

/**
 * Clear autosave backup for this process (called on successful save or clean close).
 */
function clearAutosaveBackup() {
  try {
    const dir = getAutosaveDir();
    const backupFile = path.join(dir, `autosave-${process.pid}.json`);
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
  } catch {
    // Ignore
  }
}

/**
 * Load orphaned autosave backups from crashed processes.
 * Returns array of backup objects.
 */
function loadOrphanedAutosaves() {
  try {
    const dir = getAutosaveDir();
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir);
    const backups = [];

    for (const file of files) {
      if (!file.startsWith("autosave-") || !file.endsWith(".json")) continue;

      const pidStr = file.replace("autosave-", "").replace(".json", "");
      const pid = parseInt(pidStr, 10);

      // Skip our own backup
      if (pid === process.pid) continue;

      // Check if that process is still running
      if (isProcessRunning(pid)) continue;

      // Orphaned backup — load it
      const filePath = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        data._backupFile = filePath;
        backups.push(data);
      } catch {
        // Corrupted — remove
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    return backups;
  } catch {
    return [];
  }
}

/**
 * Remove an orphaned backup file after recovery.
 */
function removeOrphanedBackup(backupFilePath) {
  try {
    if (fs.existsSync(backupFilePath)) {
      fs.unlinkSync(backupFilePath);
    }
  } catch {
    // Ignore
  }
}

/**
 * Force-save a resume backup (used when user chooses "Resume Save" on close).
 * Unlike saveAutosaveBackup(), this works even when autosave is OFF.
 * Uses a unique "resume-" prefix so it's always picked up as an orphan.
 */
function saveResumeBackup(data) {
  try {
    const dir = getAutosaveDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const backupFile = path.join(dir, `autosave-${process.pid}.json`);
    const backupData = {
      content: data.content,
      filePath: data.filePath || null,
      originalContent: data.originalContent || "",
      isDirty: true,
      pid: process.pid,
      savedAt: Date.now(),
    };
    fs.writeFileSync(backupFile, JSON.stringify(backupData), "utf-8");
  } catch {
    // Ignore write errors
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

module.exports = {
  initAutosaveManager,
  getAutosaveMinutes,
  setAutosaveMinutes,
  saveAutosaveBackup,
  saveResumeBackup,
  clearAutosaveBackup,
  loadOrphanedAutosaves,
  removeOrphanedBackup,
  getAutosaveDir,
};
