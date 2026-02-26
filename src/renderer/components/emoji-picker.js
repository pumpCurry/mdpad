/**
 * emoji-picker.js
 *
 * Discord-style emoji picker.
 * Opens as a fixed overlay, with search, category tabs, and recently used.
 */

import { getEditor } from "./editor-pane.js";
import { setEmojiButtonCallback } from "./format-toolbar.js";

const RECENT_KEY = "mdpad:recentEmojis";
const MAX_RECENT = 24;

let pickerEl = null;

// ─── Emoji Data ──────────────────────────────────────────────────────

const EMOJI_CATEGORIES = [
  {
    id: "recent",
    icon: "\uD83D\uDD52",
    label: "Recent",
    emojis: [], // populated dynamically
  },
  {
    id: "smileys",
    icon: "\uD83D\uDE00",
    label: "Smileys",
    emojis: [
      "\uD83D\uDE00","\uD83D\uDE03","\uD83D\uDE04","\uD83D\uDE01","\uD83D\uDE06","\uD83D\uDE05","\uD83D\uDE02","\uD83E\uDD23",
      "\uD83D\uDE0A","\uD83D\uDE07","\uD83D\uDE42","\uD83D\uDE43","\uD83D\uDE09","\uD83D\uDE0C","\uD83D\uDE0D","\uD83E\uDD70",
      "\uD83D\uDE18","\uD83D\uDE17","\uD83D\uDE1A","\uD83D\uDE19","\uD83E\uDD72","\uD83D\uDE0B","\uD83D\uDE1B","\uD83D\uDE1C",
      "\uD83E\uDD2A","\uD83D\uDE1D","\uD83E\uDD11","\uD83E\uDD17","\uD83E\uDD2D","\uD83E\uDD2B","\uD83E\uDD14","\uD83E\uDD10",
      "\uD83E\uDD28","\uD83D\uDE10","\uD83D\uDE11","\uD83D\uDE36","\uD83D\uDE0F","\uD83D\uDE12","\uD83D\uDE44","\uD83D\uDE2C",
      "\uD83D\uDE24","\uD83D\uDE20","\uD83D\uDE21","\uD83E\uDD2C","\uD83D\uDE22","\uD83D\uDE2D","\uD83D\uDE25","\uD83D\uDE30",
      "\uD83D\uDE28","\uD83D\uDE31","\uD83E\uDD75","\uD83E\uDD76","\uD83D\uDE33","\uD83E\uDD2F","\uD83D\uDE35","\uD83E\uDD74",
      "\uD83D\uDE34","\uD83D\uDE2A","\uD83D\uDE32","\uD83E\uDD71","\uD83D\uDE37","\uD83E\uDD12","\uD83E\uDD15","\uD83E\uDD22",
    ],
  },
  {
    id: "gestures",
    icon: "\uD83D\uDC4D",
    label: "Gestures",
    emojis: [
      "\uD83D\uDC4D","\uD83D\uDC4E","\uD83D\uDC4A","\u270A","\uD83E\uDD1B","\uD83E\uDD1C","\uD83D\uDC4F","\uD83D\uDE4C",
      "\uD83D\uDC4B","\uD83E\uDD1A","\uD83D\uDC4C","\u270C\uFE0F","\uD83E\uDD1E","\uD83E\uDD1F","\uD83E\uDD18","\uD83D\uDC48",
      "\uD83D\uDC49","\uD83D\uDC46","\uD83D\uDC47","\u261D\uFE0F","\u270B","\uD83E\uDD1A","\uD83D\uDD90\uFE0F","\uD83E\uDD19",
      "\uD83D\uDCAA","\uD83D\uDE4F","\u270D\uFE0F","\uD83E\uDD33","\uD83D\uDC85","\uD83D\uDC42","\uD83D\uDC40","\uD83D\uDC41\uFE0F",
    ],
  },
  {
    id: "nature",
    icon: "\uD83D\uDC36",
    label: "Animals",
    emojis: [
      "\uD83D\uDC36","\uD83D\uDC31","\uD83D\uDC2D","\uD83D\uDC39","\uD83D\uDC30","\uD83E\uDD8A","\uD83D\uDC3B","\uD83D\uDC3C",
      "\uD83D\uDC28","\uD83D\uDC2F","\uD83E\uDD81","\uD83D\uDC2E","\uD83D\uDC37","\uD83D\uDC38","\uD83D\uDC35","\uD83D\uDC14",
      "\uD83D\uDC27","\uD83D\uDC26","\uD83E\uDD85","\uD83E\uDD86","\uD83E\uDD89","\uD83D\uDC1D","\uD83D\uDC1B","\uD83E\uDD8B",
      "\uD83D\uDC0C","\uD83D\uDC1A","\uD83D\uDC20","\uD83D\uDC1F","\uD83D\uDC2C","\uD83D\uDC33","\uD83D\uDC0A","\uD83E\uDD95",
      "\uD83C\uDF3A","\uD83C\uDF3B","\uD83C\uDF37","\uD83C\uDF39","\uD83C\uDF3E","\uD83C\uDF32","\uD83C\uDF34","\uD83C\uDF35",
    ],
  },
  {
    id: "food",
    icon: "\uD83C\uDF54",
    label: "Food",
    emojis: [
      "\uD83C\uDF4E","\uD83C\uDF4A","\uD83C\uDF4B","\uD83C\uDF4C","\uD83C\uDF49","\uD83C\uDF47","\uD83C\uDF53","\uD83C\uDF51",
      "\uD83C\uDF52","\uD83C\uDF50","\uD83E\uDD5D","\uD83C\uDF45","\uD83E\uDD51","\uD83C\uDF46","\uD83E\uDD55","\uD83C\uDF3D",
      "\uD83C\uDF36\uFE0F","\uD83E\uDD52","\uD83E\uDD66","\uD83C\uDF5E","\uD83E\uDD50","\uD83E\uDD56","\uD83E\uDDC0","\uD83C\uDF56",
      "\uD83C\uDF54","\uD83C\uDF5F","\uD83C\uDF55","\uD83C\uDF2D","\uD83C\uDF2E","\uD83C\uDF2F","\uD83C\uDF73","\uD83C\uDF72",
      "\uD83C\uDF71","\uD83C\uDF63","\uD83C\uDF5C","\uD83C\uDF5B","\uD83C\uDF5A","\uD83C\uDF59","\uD83C\uDF58","\uD83C\uDF70",
      "\uD83C\uDF82","\uD83C\uDF67","\uD83C\uDF68","\uD83C\uDF69","\uD83C\uDF6A","\u2615","\uD83C\uDF7A","\uD83C\uDF77",
    ],
  },
  {
    id: "objects",
    icon: "\uD83D\uDCBB",
    label: "Objects",
    emojis: [
      "\uD83D\uDCBB","\uD83D\uDCF1","\uD83D\uDCF7","\uD83D\uDCF9","\uD83D\uDCFA","\uD83D\uDD0A","\uD83D\uDCE7","\uD83D\uDCC1",
      "\uD83D\uDCDD","\uD83D\uDCD6","\uD83D\uDCDA","\uD83D\uDD0D","\uD83D\uDD12","\uD83D\uDD11","\uD83D\uDCA1","\uD83D\uDD27",
      "\uD83D\uDEE0\uFE0F","\u2699\uFE0F","\uD83D\uDCCC","\uD83D\uDCCE","\u2702\uFE0F","\uD83D\uDCBC","\uD83C\uDFA8","\uD83C\uDFB5",
      "\uD83C\uDFB6","\uD83C\uDFA4","\uD83C\uDFAC","\uD83C\uDFAE","\uD83D\uDC8E","\uD83D\uDCB0","\uD83C\uDFC6","\u26BD",
      "\uD83C\uDFC0","\uD83C\uDFBE","\uD83C\uDFB1","\uD83C\uDFAF","\uD83D\uDE80","\u2708\uFE0F","\uD83D\uDE97","\uD83D\uDE82",
    ],
  },
  {
    id: "symbols",
    icon: "\u2764\uFE0F",
    label: "Symbols",
    emojis: [
      "\u2764\uFE0F","\uD83E\uDDE1","\uD83D\uDC9B","\uD83D\uDC9A","\uD83D\uDC99","\uD83D\uDC9C","\uD83D\uDDA4","\uD83D\uDC94",
      "\u2763\uFE0F","\uD83D\uDC95","\uD83D\uDC9E","\uD83D\uDC93","\uD83D\uDC97","\uD83D\uDC96","\uD83D\uDC9D","\u2B50",
      "\uD83C\uDF1F","\u26A1","\uD83D\uDD25","\u2728","\uD83C\uDF88","\uD83C\uDF89","\uD83C\uDF8A","\u2705","\u274C",
      "\u2757","\u2753","\u2795","\u2796","\u2716\uFE0F","\u267B\uFE0F","\u267E\uFE0F","\uD83D\uDCAF","\uD83C\uDD99",
      "\u26A0\uFE0F","\uD83D\uDED1","\uD83D\uDEAB","\u2139\uFE0F","\u2194\uFE0F","\u2195\uFE0F","\u27A1\uFE0F","\u2B05\uFE0F",
    ],
  },
];

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

// ─── Picker UI ───────────────────────────────────────────────────────

export function initEmojiPicker() {
  // Register callback with toolbar
  setEmojiButtonCallback((btnEl) => {
    toggleEmojiPicker(btnEl);
  });

  // Close on outside click
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

  pickerEl = document.createElement("div");
  pickerEl.className = "emoji-picker";

  // Search bar
  const searchDiv = document.createElement("div");
  searchDiv.className = "ep-search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search emoji...";
  searchDiv.appendChild(searchInput);
  pickerEl.appendChild(searchDiv);

  // Category tabs
  const tabsDiv = document.createElement("div");
  tabsDiv.className = "ep-tabs";

  EMOJI_CATEGORIES.forEach((cat) => {
    const tab = document.createElement("button");
    tab.className = "ep-tab";
    tab.textContent = cat.icon;
    tab.title = cat.label;
    tab.dataset.catId = cat.id;
    tab.addEventListener("click", () => {
      scrollToCategory(cat.id);
      setActiveTab(cat.id);
    });
    tabsDiv.appendChild(tab);
  });

  pickerEl.appendChild(tabsDiv);

  // Emoji grid
  const gridDiv = document.createElement("div");
  gridDiv.className = "ep-grid";

  // Populate recent
  EMOJI_CATEGORIES[0].emojis = getRecentEmojis();

  EMOJI_CATEGORIES.forEach((cat) => {
    if (cat.id === "recent" && cat.emojis.length === 0) return; // Skip empty recent

    const section = document.createElement("div");
    section.dataset.catId = cat.id;

    const label = document.createElement("div");
    label.className = "ep-category-label";
    label.textContent = cat.label;
    section.appendChild(label);

    const row = document.createElement("div");
    row.className = "ep-emoji-row";

    cat.emojis.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.className = "ep-emoji";
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener("click", () => {
        insertEmoji(emoji);
        addRecentEmoji(emoji);
      });
      row.appendChild(btn);
    });

    section.appendChild(row);
    gridDiv.appendChild(section);
  });

  pickerEl.appendChild(gridDiv);

  document.body.appendChild(pickerEl);

  // Position relative to anchor
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;

    // Boundary check
    if (left + 340 > window.innerWidth) left = window.innerWidth - 344;
    if (top + 360 > window.innerHeight) top = rect.top - 364;
    if (left < 0) left = 4;
    if (top < 0) top = 4;

    pickerEl.style.left = left + "px";
    pickerEl.style.top = top + "px";
  }

  // Set first active tab
  setActiveTab(EMOJI_CATEGORIES[0].emojis.length > 0 ? "recent" : "smileys");

  // Search handler
  searchInput.addEventListener("input", () => {
    filterEmojis(searchInput.value.trim().toLowerCase(), gridDiv);
  });

  searchInput.focus();
}

function closeEmojiPicker() {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}

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

function scrollToCategory(catId) {
  if (!pickerEl) return;
  const gridDiv = pickerEl.querySelector(".ep-grid");
  const section = gridDiv.querySelector(`[data-cat-id="${catId}"]`);
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setActiveTab(catId) {
  if (!pickerEl) return;
  const tabs = pickerEl.querySelectorAll(".ep-tab");
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.catId === catId);
  });
}

function filterEmojis(query, gridDiv) {
  if (!query) {
    // Show all
    gridDiv.querySelectorAll("[data-cat-id]").forEach((section) => {
      section.style.display = "";
    });
    const noResults = gridDiv.querySelector(".ep-no-results");
    if (noResults) noResults.remove();
    return;
  }

  // Hide all category sections and show a flat filtered grid
  let found = 0;
  gridDiv.querySelectorAll("[data-cat-id]").forEach((section) => {
    section.style.display = "none";
  });

  // Remove existing no-results
  const existing = gridDiv.querySelector(".ep-no-results");
  if (existing) existing.remove();

  // Remove existing search results
  const existingResults = gridDiv.querySelector(".ep-search-results");
  if (existingResults) existingResults.remove();

  // Build search results
  const resultsDiv = document.createElement("div");
  resultsDiv.className = "ep-search-results";
  const row = document.createElement("div");
  row.className = "ep-emoji-row";

  // Search through all categories (skip recent)
  const allEmojis = new Set();
  EMOJI_CATEGORIES.forEach((cat) => {
    if (cat.id === "recent") return;
    cat.emojis.forEach((emoji) => {
      if (!allEmojis.has(emoji)) {
        allEmojis.add(emoji);
        // Simple search: check if any character in query matches the emoji
        // For better search, we'd need a name database, but emoji characters themselves work
        row.appendChild(createEmojiBtn(emoji));
        found++;
      }
    });
  });

  if (found > 0) {
    resultsDiv.appendChild(row);
    gridDiv.appendChild(resultsDiv);
  } else {
    const noResults = document.createElement("div");
    noResults.className = "ep-no-results";
    noResults.textContent = "No emoji found";
    gridDiv.appendChild(noResults);
  }
}

function createEmojiBtn(emoji) {
  const btn = document.createElement("button");
  btn.className = "ep-emoji";
  btn.textContent = emoji;
  btn.title = emoji;
  btn.addEventListener("click", () => {
    insertEmoji(emoji);
    addRecentEmoji(emoji);
  });
  return btn;
}
