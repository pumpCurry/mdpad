const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function getConfigPath() {
  return path.join(app.getPath("userData"), "mdpad-config.json");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Ignore write errors
  }
}

function restoreWindowState() {
  const config = readConfig();
  return {
    width: config.windowWidth || 1200,
    height: config.windowHeight || 800,
    x: config.windowX,
    y: config.windowY,
    isMaximized: config.isMaximized || false,
  };
}

function saveWindowState(win) {
  if (!win) return;
  const config = readConfig();
  config.isMaximized = win.isMaximized();
  if (!win.isMaximized()) {
    const bounds = win.getBounds();
    config.windowWidth = bounds.width;
    config.windowHeight = bounds.height;
    config.windowX = bounds.x;
    config.windowY = bounds.y;
  }
  writeConfig(config);
}

module.exports = { restoreWindowState, saveWindowState };
