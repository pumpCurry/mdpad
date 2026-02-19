/**
 * i18n module for the renderer process (ESM).
 * Locale data is passed from the main process via preload.
 */

import enData from "./locales/en.json";
import jaData from "./locales/ja.json";

const localeData = {
  en: enData,
  ja: jaData,
};

let currentLocale = "en";
let onLocaleChangeCallbacks = [];

/**
 * Initialize with the locale from the main process.
 */
export function initI18n(locale) {
  currentLocale = locale || "en";
}

/**
 * Get a translated string by dot-separated key.
 */
export function t(key) {
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
          return key;
        }
      }
      return fallback;
    }
  }
  return val;
}

/**
 * Change locale at runtime. Triggers all registered callbacks.
 */
export function setLocale(locale) {
  if (localeData[locale]) {
    currentLocale = locale;
    for (const cb of onLocaleChangeCallbacks) {
      cb(locale);
    }
  }
}

export function getLocale() {
  return currentLocale;
}

/**
 * Register a callback that fires when the locale changes.
 * Used by components to re-render their UI.
 */
export function onLocaleChange(callback) {
  onLocaleChangeCallbacks.push(callback);
}
