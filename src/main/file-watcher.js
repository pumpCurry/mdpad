/**
 * File watcher module — monitors opened files for external changes.
 * Uses fs.watch with per-window isolation and debouncing.
 */
const fs = require("fs");

// Map<windowId, { watcher, filePath, debounceTimer, ignoring }>
const watchers = new Map();

const DEBOUNCE_MS = 500;

/**
 * Start watching a file for changes.
 * @param {number} windowId - Unique window identifier
 * @param {string} filePath - Absolute path to the file
 * @param {Function} onChange - Callback invoked when file changes externally
 */
function startWatch(windowId, filePath, onChange) {
  // Stop any existing watcher for this window
  stopWatch(windowId);

  try {
    const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
      const entry = watchers.get(windowId);
      if (!entry) return;

      // Skip if we're ignoring changes (self-write protection)
      if (entry.ignoring) return;

      // Debounce: clear previous timer and set new one
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        // Verify the file still exists (could be a delete event)
        try {
          fs.accessSync(filePath, fs.constants.R_OK);
          onChange();
        } catch {
          // File was deleted — don't notify
        }
      }, DEBOUNCE_MS);
    });

    watcher.on("error", () => {
      // Silently stop watching on error
      stopWatch(windowId);
    });

    watchers.set(windowId, {
      watcher,
      filePath,
      debounceTimer: null,
      ignoring: false,
    });
  } catch {
    // Failed to watch (e.g. file doesn't exist) — silently ignore
  }
}

/**
 * Stop watching for a specific window.
 * @param {number} windowId
 */
function stopWatch(windowId) {
  const entry = watchers.get(windowId);
  if (!entry) return;

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  try {
    entry.watcher.close();
  } catch {
    // Ignore close errors
  }
  watchers.delete(windowId);
}

/**
 * Stop all watchers (called on app quit).
 */
function stopAllWatchers() {
  for (const [windowId] of watchers) {
    stopWatch(windowId);
  }
}

/**
 * Set the ignoring flag (self-write protection).
 * When true, file change events are suppressed.
 * @param {number} windowId
 * @param {boolean} flag
 */
function setIgnoring(windowId, flag) {
  const entry = watchers.get(windowId);
  if (entry) {
    entry.ignoring = flag;
  }
}

module.exports = { startWatch, stopWatch, stopAllWatchers, setIgnoring };
