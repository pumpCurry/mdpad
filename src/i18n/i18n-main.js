/**
 * i18n module for the main process (CommonJS).
 * Detects OS locale and provides translation functions.
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const localesDir = path.join(__dirname, "locales");
const supportedLocales = ["en", "ja"];
const localeData = {};

// Pre-load all locale files
for (const loc of supportedLocales) {
  const filePath = path.join(localesDir, `${loc}.json`);
  localeData[loc] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

let currentLocale = "en";

/**
 * Detect the best matching locale from the OS/app settings.
 */
function detectLocale() {
  // Try stored preference first
  const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.locale && supportedLocales.includes(config.locale)) {
      return config.locale;
    }
  } catch {
    // no config yet
  }

  // Fall back to OS locale
  const osLocale = app.getLocale(); // e.g. "ja", "ja-JP", "en-US"
  const lang = osLocale.split("-")[0].toLowerCase();
  if (supportedLocales.includes(lang)) {
    return lang;
  }
  return "en";
}

/**
 * Initialize with detected or stored locale.
 */
function initLocale() {
  currentLocale = detectLocale();
}

/**
 * Get a translated string by dot-separated key.
 * e.g. t("menu.file") => "ファイル"
 */
function t(key) {
  const parts = key.split(".");
  let val = localeData[currentLocale];
  for (const p of parts) {
    if (val && typeof val === "object" && p in val) {
      val = val[p];
    } else {
      // Fallback to English
      let fallback = localeData["en"];
      for (const fp of parts) {
        if (fallback && typeof fallback === "object" && fp in fallback) {
          fallback = fallback[fp];
        } else {
          return key; // key not found at all
        }
      }
      return fallback;
    }
  }
  return val;
}

/**
 * Change locale at runtime.
 */
function setLocale(locale) {
  if (supportedLocales.includes(locale)) {
    currentLocale = locale;
    // Persist to config
    const configPath = path.join(app.getPath("userData"), "mdpad-config.json");
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // empty
    }
    config.locale = locale;
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }
}

function getLocale() {
  return currentLocale;
}

function getSupportedLocales() {
  return [...supportedLocales];
}

function getLocaleData(locale) {
  return localeData[locale] || localeData["en"];
}

module.exports = {
  initLocale,
  t,
  setLocale,
  getLocale,
  getSupportedLocales,
  getLocaleData,
};
