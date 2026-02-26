/**
 * File watch settings manager for mdpad.
 * Stores fileWatchEnabled and autoReloadEnabled in mdpad-config.json.
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let fileWatchEnabled = true;
let autoReloadEnabled = true;

function initFileWatchSettings() {
  const config = loadConfig();
  if (typeof config.fileWatchEnabled === "boolean") {
    fileWatchEnabled = config.fileWatchEnabled;
  }
  if (typeof config.autoReloadEnabled === "boolean") {
    autoReloadEnabled = config.autoReloadEnabled;
  }
}

function getFileWatchEnabled() {
  return fileWatchEnabled;
}

function setFileWatchEnabled(enabled) {
  fileWatchEnabled = !!enabled;
  saveConfigKey("fileWatchEnabled", fileWatchEnabled);
}

function getAutoReloadEnabled() {
  return autoReloadEnabled;
}

function setAutoReloadEnabled(enabled) {
  autoReloadEnabled = !!enabled;
  saveConfigKey("autoReloadEnabled", autoReloadEnabled);
}

function loadConfig() {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfigKey(key, value) {
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // empty
  }
  config[key] = value;
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

module.exports = {
  initFileWatchSettings,
  getFileWatchEnabled,
  setFileWatchEnabled,
  getAutoReloadEnabled,
  setAutoReloadEnabled,
};
