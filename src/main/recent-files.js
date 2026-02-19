const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const MAX_RECENT = 10;

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

function getRecentFiles() {
  const config = readConfig();
  return config.recentFiles || [];
}

function addRecentFile(filePath) {
  const config = readConfig();
  let recent = config.recentFiles || [];
  recent = recent.filter((f) => f !== filePath);
  recent.unshift(filePath);
  if (recent.length > MAX_RECENT) {
    recent = recent.slice(0, MAX_RECENT);
  }
  config.recentFiles = recent;
  writeConfig(config);
}

module.exports = { getRecentFiles, addRecentFile };
