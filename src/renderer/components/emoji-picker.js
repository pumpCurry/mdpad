/**
 * emoji-picker.js
 *
 * Discord-style emoji picker with:
 *  - Vertical category sidebar
 *  - Skin tone selector (6 tones)
 *  - Hover status bar with :shortcode: names
 *  - Name search mode (:xxx: input)
 */

import { getEditor } from "./editor-pane.js";
import { setEmojiButtonCallback } from "./format-toolbar.js";
import { t } from "../../i18n/i18n-renderer.js";
import { EMOJI_NAMES, SKIN_TONE_EMOJI, EMOJI_CATEGORIES } from "../data/emoji-names.js";

const RECENT_KEY = "mdpad:recentEmojis";
const SKIN_TONE_KEY = "mdpad:emojiSkinTone";
const MAX_RECENT = 24;

// Skin tone modifiers
const SKIN_TONES = [
  { id: "default", modifier: "", label: "\u{1F44D}" },
  { id: "light", modifier: "\u{1F3FB}", label: "\u{1F44D}\u{1F3FB}" },
  { id: "medium-light", modifier: "\u{1F3FC}", label: "\u{1F44D}\u{1F3FC}" },
  { id: "medium", modifier: "\u{1F3FD}", label: "\u{1F44D}\u{1F3FD}" },
  { id: "medium-dark", modifier: "\u{1F3FE}", label: "\u{1F44D}\u{1F3FE}" },
  { id: "dark", modifier: "\u{1F3FF}", label: "\u{1F44D}\u{1F3FF}" },
];

let pickerEl = null;
let currentSkinTone = "";
let nameSearchMode = false;
let scrollObserver = null;

// ─── Recent Emojis ───────────────────────────────────────────────────

function getRecentEmojis() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
}

function addRecentEmoji(emoji) {
  const recent = getRecentEmojis().filter((e) => e !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

// ─── Skin Tone ───────────────────────────────────────────────────────

function getSkinTone() {
  return localStorage.getItem(SKIN_TONE_KEY) || "";
}

function setSkinTone(modifier) {
  currentSkinTone = modifier;
  localStorage.setItem(SKIN_TONE_KEY, modifier);
}

/** Strip any existing skin tone modifier from an emoji string. */
function stripTone(emoji) {
  return emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/u, "");
}

/** Apply current skin tone to an emoji if it supports modifiers. */
function applyTone(emoji) {
  const base = stripTone(emoji);
  if (!currentSkinTone) return base;
  if (!SKIN_TONE_EMOJI.has(base)) return base;
  return base + currentSkinTone;
}

// ─── Picker UI ───────────────────────────────────────────────────────

export function initEmojiPicker() {
  setEmojiButtonCallback((btnEl) => {
    toggleEmojiPicker(btnEl);
  });

  document.addEventListener("mousedown", (e) => {
    if (pickerEl && !pickerEl.contains(e.target) && e.target.id !== "fb-emoji-btn") {
      closeEmojiPicker();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pickerEl) {
      closeEmojiPicker();
    }
  });

  // Close when a modal dialog opens
  window.addEventListener("mdpad:closePopups", () => closeEmojiPicker());
}

function toggleEmojiPicker(anchorEl) {
  if (pickerEl) {
    closeEmojiPicker();
    return;
  }
  openEmojiPicker(anchorEl);
}

function openEmojiPicker(anchorEl) {
  closeEmojiPicker();

  currentSkinTone = getSkinTone();
  nameSearchMode = false;

  pickerEl = document.createElement("div");
  pickerEl.className = "emoji-picker";

  // ── Header: search + skin tone + name mode ──

  const headerDiv = document.createElement("div");
  headerDiv.className = "ep-header";

  // Search
  const searchDiv = document.createElement("div");
  searchDiv.className = "ep-search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = t("emojiPicker.search") || "Search emoji...";
  searchDiv.appendChild(searchInput);
  headerDiv.appendChild(searchDiv);

  // Skin tone button
  const skinToneBtn = document.createElement("button");
  skinToneBtn.className = "ep-skin-tone-btn";
  skinToneBtn.title = t("emojiPicker.skinTone") || "Skin tone";
  const currentToneObj = SKIN_TONES.find((s) => s.modifier === currentSkinTone) || SKIN_TONES[0];
  skinToneBtn.textContent = currentToneObj.label;
  skinToneBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Toggle dropdown
    const existing = pickerEl.querySelector(".ep-skin-tone-dropdown");
    if (existing) {
      existing.remove();
      return;
    }
    const dropdown = createSkinToneDropdown(skinToneBtn);
    skinToneBtn.appendChild(dropdown);
  });
  headerDiv.appendChild(skinToneBtn);

  // Name mode toggle - switches insert output between emoji char and :shortcode:
  const nameModeBtn = document.createElement("button");
  nameModeBtn.className = "ep-name-mode-btn";
  nameModeBtn.title = t("emojiPicker.nameMode") || "Insert as :shortcode:";
  nameModeBtn.textContent = "::";
  nameModeBtn.addEventListener("click", () => {
    nameSearchMode = !nameSearchMode;
    nameModeBtn.classList.toggle("active", nameSearchMode);
    searchInput.placeholder = nameSearchMode
      ? (t("emojiPicker.searchByName") || "Search by :name:...")
      : (t("emojiPicker.search") || "Search emoji...");
    searchInput.focus();
  });
  headerDiv.appendChild(nameModeBtn);

  pickerEl.appendChild(headerDiv);

  // ── Body: sidebar + grid ──

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "ep-body";

  // Sidebar
  const sidebarDiv = document.createElement("div");
  sidebarDiv.className = "ep-sidebar";

  EMOJI_CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "ep-sidebar-btn";
    btn.textContent = (cat.id === "people") ? applyTone(cat.icon) : cat.icon;
    btn.title = t("emojiPicker." + cat.id) || cat.label;
    btn.dataset.catId = cat.id;
    btn.addEventListener("click", () => {
      scrollToCategory(cat.id);
      setActiveSidebarBtn(cat.id);
    });
    sidebarDiv.appendChild(btn);
  });

  bodyDiv.appendChild(sidebarDiv);

  // Grid area
  const gridArea = document.createElement("div");
  gridArea.className = "ep-grid-area";

  // Populate recent
  EMOJI_CATEGORIES[0].emojis = getRecentEmojis();

  // Status bar references (needed by emoji button builders)
  const statusEmoji = document.createElement("span");
  statusEmoji.className = "ep-status-emoji";
  const statusShortcode = document.createElement("span");
  statusShortcode.className = "ep-status-shortcode";
  const statusName = document.createElement("span");
  statusName.className = "ep-status-name";
  statusName.textContent = t("emojiPicker.defaultStatus") || "Pick an emoji...";

  EMOJI_CATEGORIES.forEach((cat) => {
    if (cat.id === "recent" && cat.emojis.length === 0) return;

    const section = document.createElement("div");
    section.dataset.catId = cat.id;

    const label = document.createElement("div");
    label.className = "ep-category-label";
    label.textContent = t("emojiPicker." + cat.id) || cat.label;
    section.appendChild(label);

    const row = document.createElement("div");
    row.className = "ep-emoji-row";

    cat.emojis.forEach((emoji) => {
      const baseEmoji = stripTone(emoji);
      const btn = createEmojiBtn(baseEmoji, statusEmoji, statusShortcode, statusName);
      row.appendChild(btn);
    });

    section.appendChild(row);
    gridArea.appendChild(section);
  });

  bodyDiv.appendChild(gridArea);
  pickerEl.appendChild(bodyDiv);

  // ── Status bar ──

  const statusBar = document.createElement("div");
  statusBar.className = "ep-status-bar";
  statusBar.appendChild(statusEmoji);
  statusBar.appendChild(statusShortcode);
  statusBar.appendChild(statusName);
  pickerEl.appendChild(statusBar);

  // ── Append to DOM and position ──

  document.body.appendChild(pickerEl);

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;

    if (left + 420 > window.innerWidth) left = window.innerWidth - 424;
    if (top + 400 > window.innerHeight) top = rect.top - 404;
    if (left < 0) left = 4;
    if (top < 0) top = 4;

    pickerEl.style.left = left + "px";
    pickerEl.style.top = top + "px";
  }

  // Set initial active sidebar button
  setActiveSidebarBtn(EMOJI_CATEGORIES[0].emojis.length > 0 ? "recent" : "smileys");

  // ── Scroll tracking ──

  setupScrollObserver(gridArea);

  // ── Search handler ──

  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim();

    // Exact :shortcode: match -> auto-insert
    if (val.startsWith(":") && val.endsWith(":") && val.length > 2) {
      const code = val.slice(1, -1).toLowerCase();
      for (const [emoji, info] of EMOJI_NAMES) {
        if (info.shortcode === code) {
          if (nameSearchMode) {
            insertEmoji(":" + info.shortcode + ":");
          } else {
            insertEmoji(applyTone(emoji));
          }
          addRecentEmoji(emoji);
          closeEmojiPicker();
          return;
        }
      }
    }

    filterEmojis(val.toLowerCase(), gridArea);
  });

  searchInput.focus();
}

function closeEmojiPicker() {
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}

// ─── Emoji insertion ─────────────────────────────────────────────────

function insertEmoji(emoji) {
  const view = getEditor();
  if (!view) return;

  const from = view.state.selection.main.head;
  view.dispatch({
    changes: { from, to: from, insert: emoji },
    selection: { anchor: from + emoji.length },
  });
  view.focus();
}

// ─── Skin tone dropdown ─────────────────────────────────────────────

function createSkinToneDropdown(skinToneBtn) {
  const dropdown = document.createElement("div");
  dropdown.className = "ep-skin-tone-dropdown";

  SKIN_TONES.forEach((tone) => {
    const opt = document.createElement("button");
    opt.className = "ep-skin-tone-option";
    if (tone.modifier === currentSkinTone) opt.classList.add("active");
    opt.textContent = tone.label;
    opt.title = tone.id;
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      setSkinTone(tone.modifier);
      skinToneBtn.textContent = tone.label;
      refreshGridTones();
      // Update people sidebar icon (skin-tone capable)
      if (pickerEl) {
        const peopleSidebarBtn = pickerEl.querySelector('.ep-sidebar-btn[data-cat-id="people"]');
        if (peopleSidebarBtn) {
          peopleSidebarBtn.textContent = applyTone("\u{1F464}");
        }
      }
      dropdown.remove();
    });
    dropdown.appendChild(opt);
  });

  return dropdown;
}

function refreshGridTones() {
  if (!pickerEl) return;
  const buttons = pickerEl.querySelectorAll(".ep-emoji[data-base-emoji]");
  buttons.forEach((btn) => {
    const base = btn.dataset.baseEmoji;
    btn.textContent = applyTone(base);
  });
}

// ─── Sidebar & scroll tracking ───────────────────────────────────────

function scrollToCategory(catId) {
  if (!pickerEl) return;
  const gridArea = pickerEl.querySelector(".ep-grid-area");
  const section = gridArea.querySelector(`[data-cat-id="${catId}"]`);
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setActiveSidebarBtn(catId) {
  if (!pickerEl) return;
  const btns = pickerEl.querySelectorAll(".ep-sidebar-btn");
  btns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.catId === catId);
  });
}

function setupScrollObserver(gridArea) {
  const sections = gridArea.querySelectorAll("[data-cat-id]");
  if (sections.length === 0) return;

  scrollObserver = new IntersectionObserver(
    (entries) => {
      let topSection = null;
      let topY = Infinity;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const rect = entry.boundingClientRect;
          if (rect.top < topY) {
            topY = rect.top;
            topSection = entry.target;
          }
        }
      });
      if (topSection) {
        setActiveSidebarBtn(topSection.dataset.catId);
      }
    },
    {
      root: gridArea,
      threshold: 0,
      rootMargin: "0px 0px -80% 0px",
    }
  );

  sections.forEach((section) => scrollObserver.observe(section));
}

// ─── Search / Filter ─────────────────────────────────────────────────

function filterEmojis(query, gridArea) {
  // Remove existing search results
  const existingResults = gridArea.querySelector(".ep-search-results");
  if (existingResults) existingResults.remove();
  const existingNoResults = gridArea.querySelector(".ep-no-results");
  if (existingNoResults) existingNoResults.remove();

  if (!query) {
    // Show all category sections
    gridArea.querySelectorAll("[data-cat-id]").forEach((section) => {
      section.style.display = "";
    });
    return;
  }

  // Hide all category sections
  gridArea.querySelectorAll("[data-cat-id]").forEach((section) => {
    section.style.display = "none";
  });

  // Strip colons for shortcode matching
  let searchTerm = query;
  if (searchTerm.startsWith(":")) searchTerm = searchTerm.slice(1);
  if (searchTerm.endsWith(":")) searchTerm = searchTerm.slice(0, -1);
  if (!searchTerm) return;

  // Build search results
  const resultsDiv = document.createElement("div");
  resultsDiv.className = "ep-search-results";
  const row = document.createElement("div");
  row.className = "ep-emoji-row";
  let found = 0;

  const seen = new Set();

  // Get status bar references
  const statusEmoji = pickerEl.querySelector(".ep-status-emoji");
  const statusShortcode = pickerEl.querySelector(".ep-status-shortcode");
  const statusName = pickerEl.querySelector(".ep-status-name");

  EMOJI_CATEGORIES.forEach((cat) => {
    if (cat.id === "recent") return;
    cat.emojis.forEach((emoji) => {
      const base = stripTone(emoji);
      if (seen.has(base)) return;
      seen.add(base);

      const info = EMOJI_NAMES.get(base);
      let match = false;

      if (info) {
        match = info.shortcode.includes(searchTerm) ||
                info.name.toLowerCase().includes(searchTerm);
      }

      if (match) {
        row.appendChild(createEmojiBtn(base, statusEmoji, statusShortcode, statusName));
        found++;
      }
    });
  });

  if (found > 0) {
    resultsDiv.appendChild(row);
    gridArea.appendChild(resultsDiv);
  } else {
    const noResults = document.createElement("div");
    noResults.className = "ep-no-results";
    noResults.textContent = t("emojiPicker.noResults") || "No emoji found";
    gridArea.appendChild(noResults);
  }
}

// ─── Emoji button factory ────────────────────────────────────────────

function createEmojiBtn(baseEmoji, statusEmoji, statusShortcode, statusName) {
  const btn = document.createElement("button");
  btn.className = "ep-emoji";
  btn.dataset.baseEmoji = baseEmoji;
  btn.textContent = applyTone(baseEmoji);

  // Hover -> update status bar
  btn.addEventListener("mouseenter", () => {
    const info = EMOJI_NAMES.get(baseEmoji);
    statusEmoji.textContent = applyTone(baseEmoji);
    if (info) {
      statusShortcode.textContent = ":" + info.shortcode + ":";
      statusName.textContent = info.name;
    } else {
      statusShortcode.textContent = "";
      statusName.textContent = "";
    }
  });

  btn.addEventListener("mouseleave", () => {
    statusEmoji.textContent = "";
    statusShortcode.textContent = "";
    statusName.textContent = t("emojiPicker.defaultStatus") || "Pick an emoji...";
  });

  // Click -> insert (emoji char or :shortcode: depending on mode)
  btn.addEventListener("click", () => {
    if (nameSearchMode) {
      const info = EMOJI_NAMES.get(baseEmoji);
      if (info) {
        insertEmoji(":" + info.shortcode + ":");
      } else {
        insertEmoji(applyTone(baseEmoji));
      }
    } else {
      insertEmoji(applyTone(baseEmoji));
    }
    addRecentEmoji(baseEmoji);
  });

  return btn;
}
