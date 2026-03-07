/**
 * @fileoverview 書式ツールバー。3つの表示モード（topbar/sidebar/hidden）を持ち、
 * クリック可能な書式ボタンとアクティブ状態のトラッキングを提供する。
 * カラーパレットには色履歴セクションを含む。
 *
 * @description format-toolbar.js — Format toolbar
 * @file format-toolbar.js
 * @module format-toolbar
 * @version 0.1.10020
 * @revision 1
 * @lastModified 2026-03-07 20:00:00 (JST)
 */

import { FORMAT_COMMANDS, isFormatActive, getFormatCommand, insertColor, getColorHistory } from "./format-commands.js";
import { getEditor } from "./editor-pane.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

const STORAGE_KEY = "mdpad:formatBarMode";

let currentMode = null; // "topbar" | "sidebar" | "hidden"
let formatBarEl = null;
let updateTimer = null;
let activeDropdown = null;
let emojiCallback = null; // Set externally by emoji-picker

/**
 * Initialize format toolbar. Reads mode from localStorage and renders.
 */
export function initFormatToolbar() {
  currentMode = localStorage.getItem(STORAGE_KEY) || "hidden";
  renderFormatBar();

  // Track cursor/selection changes to update active states
  const view = getEditor();
  if (view) {
    // Use interval-based polling for selection changes (simpler than ViewPlugin)
    setInterval(() => updateActiveStates(), 250);
  }

  // Re-render on locale change
  onLocaleChange(() => renderFormatBar());

  // Close dropdown on click outside
  document.addEventListener("mousedown", (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeDropdown();
    }
  });

  // Close all toolbar popups when a modal dialog opens
  window.addEventListener("mdpad:closePopups", () => {
    closeDropdown();
    closeColorPalette();
  });
}

/**
 * Set the format bar mode.
 * @param {"topbar"|"sidebar"|"hidden"} mode
 */
export function setFormatBarMode(mode) {
  currentMode = mode;
  localStorage.setItem(STORAGE_KEY, mode);
  // メインプロセスのメニュー状態を同期（ラジオボタンの checked を更新）
  if (window.mdpad && window.mdpad.setFormatBarModeMain) {
    window.mdpad.setFormatBarModeMain(mode);
  }
  renderFormatBar();
}

/**
 * Get the current format bar mode.
 */
export function getFormatBarMode() {
  return currentMode;
}

/**
 * Register the emoji button callback (called by emoji-picker).
 */
export function setEmojiButtonCallback(cb) {
  emojiCallback = cb;
}

function renderFormatBar() {
  // Remove existing format bar
  if (formatBarEl) {
    formatBarEl.remove();
    formatBarEl = null;
  }

  // Restore pane-container height
  adjustLayout();

  if (currentMode === "hidden") return;

  formatBarEl = document.createElement("div");

  if (currentMode === "topbar") {
    renderTopbar();
  } else if (currentMode === "sidebar") {
    renderSidebar();
  }
}

function renderTopbar() {
  formatBarEl.className = "format-bar--topbar";
  formatBarEl.id = "format-bar";

  const view = getEditor();

  // Define the button layout for topbar
  const layout = [
    // Inline
    "bold", "italic", "underline", "strikethrough", "inlineCode",
    "|",
    // Links
    "link", "image",
    "|",
    // Heading dropdown
    "heading_dropdown",
    "|",
    // Lists
    "bulletList", "numberedList", "taskList", "blockquote", "codeBlock",
    "|",
    // Blocks
    "table", "horizontalRule", "details", "definitionList", "kbd", "escape",
    "|",
    // Emoji button
    "emoji",
    "|",
    // Color palette
    "color",
  ];

  layout.forEach((item) => {
    if (item === "|") {
      const sep = document.createElement("div");
      sep.className = "fb-sep";
      formatBarEl.appendChild(sep);
    } else if (item === "heading_dropdown") {
      formatBarEl.appendChild(createHeadingDropdown(view));
    } else if (item === "emoji") {
      formatBarEl.appendChild(createEmojiButton());
    } else {
      const cmd = getFormatCommand(item);
      if (!cmd) return;
      formatBarEl.appendChild(createFormatButton(view, cmd));
    }
  });

  // Insert after #toolbar
  const toolbar = document.getElementById("toolbar");
  if (toolbar && toolbar.nextSibling) {
    toolbar.parentNode.insertBefore(formatBarEl, toolbar.nextSibling);
  } else {
    document.body.insertBefore(formatBarEl, document.getElementById("pane-container") || document.getElementById("main-content"));
  }

  adjustLayout();
}

function renderSidebar() {
  formatBarEl.className = "format-bar--sidebar";
  formatBarEl.id = "format-bar";

  const view = getEditor();

  // Sidebar layout: vertical, similar items
  const layout = [
    "bold", "italic", "underline", "strikethrough", "inlineCode",
    "|",
    "link", "image",
    "|",
    "heading_dropdown",
    "|",
    "bulletList", "numberedList", "taskList", "blockquote", "codeBlock",
    "|",
    "table", "horizontalRule", "details", "definitionList", "kbd", "escape",
    "|",
    "emoji",
    "|",
    "color",
  ];

  layout.forEach((item) => {
    if (item === "|") {
      const sep = document.createElement("div");
      sep.className = "fb-sep";
      formatBarEl.appendChild(sep);
    } else if (item === "heading_dropdown") {
      formatBarEl.appendChild(createHeadingDropdown(view));
    } else if (item === "emoji") {
      formatBarEl.appendChild(createEmojiButton());
    } else {
      const cmd = getFormatCommand(item);
      if (!cmd) return;
      formatBarEl.appendChild(createFormatButton(view, cmd));
    }
  });

  // Insert before #pane-container, inside a wrapper
  ensureMainContentWrapper();
  const mainContent = document.getElementById("main-content");
  if (mainContent) {
    mainContent.insertBefore(formatBarEl, mainContent.firstChild);
  }

  adjustLayout();
}

function createFormatButton(view, cmd) {
  const btn = document.createElement("button");
  btn.className = "fb-btn";
  btn.dataset.formatId = cmd.id;
  btn.title = t(cmd.i18nKey) + (cmd.shortcut ? ` (${cmd.shortcut})` : "");
  btn.textContent = cmd.icon;
  if (cmd.iconStyle) btn.style.cssText = cmd.iconStyle;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (cmd.id === "color") {
      showColorPalette(btn);
      return;
    }
    const currentView = getEditor();
    if (currentView && cmd.fn) {
      cmd.fn(currentView);
      currentView.focus();
      // Defer active state update
      setTimeout(() => updateActiveStates(), 50);
    }
  });

  return btn;
}

function createHeadingDropdown(view) {
  const container = document.createElement("div");
  container.className = "fb-dropdown";

  const btn = document.createElement("button");
  btn.className = "fb-btn";
  btn.dataset.formatId = "heading";
  btn.title = t("format.heading");
  btn.textContent = "H\u25BC";
  btn.style.cssText = "font-weight:bold;font-size:11px";

  // Store menu builder on the button so we can create the overlay on click
  btn._buildMenu = () => {
    const menu = document.createElement("div");
    menu.className = "fb-dropdown-overlay";

    for (let i = 1; i <= 6; i++) {
      const cmd = getFormatCommand(`h${i}`);
      if (!cmd) continue;

      const item = document.createElement("div");
      item.className = "fb-dropdown-item";
      item.dataset.formatId = cmd.id;

      const check = document.createElement("span");
      check.className = "fb-dd-check";
      item.appendChild(check);

      const label = document.createElement("span");
      label.textContent = t(cmd.i18nKey);
      label.style.fontSize = `${16 - i}px`;
      label.style.fontWeight = "bold";
      item.appendChild(label);

      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        const currentView = getEditor();
        if (currentView && cmd.fn) {
          cmd.fn(currentView);
          currentView.focus();
          setTimeout(() => updateActiveStates(), 50);
        }
      });

      menu.appendChild(item);
    }
    return menu;
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeDropdown) {
      closeDropdown();
      return;
    }
    closeDropdown();

    // Create overlay and position it relative to the button
    const menu = btn._buildMenu();
    document.body.appendChild(menu);

    const btnRect = btn.getBoundingClientRect();
    // For topbar: position below button; for sidebar: position to the right
    if (currentMode === "sidebar") {
      menu.style.left = (btnRect.right + 2) + "px";
      menu.style.top = btnRect.top + "px";
    } else {
      menu.style.left = btnRect.left + "px";
      menu.style.top = btnRect.bottom + 2 + "px";
    }

    // Viewport boundary check
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - menuRect.width - 4) + "px";
    }
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }

    activeDropdown = menu;
    updateDropdownActiveStates(menu);
  });

  container.appendChild(btn);

  return container;
}

function createEmojiButton() {
  const btn = document.createElement("button");
  btn.className = "fb-btn";
  btn.id = "fb-emoji-btn";
  btn.title = "Emoji";
  btn.textContent = "\uD83D\uDE00";
  btn.style.fontSize = "14px";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (emojiCallback) {
      emojiCallback(btn);
    }
  });

  return btn;
}

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
}

function updateDropdownActiveStates(menu) {
  const view = getEditor();
  if (!view) return;

  const items = menu.querySelectorAll(".fb-dropdown-item");
  items.forEach((item) => {
    const id = item.dataset.formatId;
    const active = isFormatActive(view, id);
    item.classList.toggle("active", active);
    const check = item.querySelector(".fb-dd-check");
    if (check) check.textContent = active ? "\u2713" : "";
  });
}

function updateActiveStates() {
  if (!formatBarEl || currentMode === "hidden") return;

  const view = getEditor();
  if (!view) return;

  const buttons = formatBarEl.querySelectorAll(".fb-btn[data-format-id]");
  buttons.forEach((btn) => {
    const id = btn.dataset.formatId;
    if (id === "heading") {
      // Check if any heading is active
      let anyActive = false;
      for (let i = 1; i <= 6; i++) {
        if (isFormatActive(view, `h${i}`)) {
          anyActive = true;
          break;
        }
      }
      btn.classList.toggle("active", anyActive);
    } else {
      const cmd = getFormatCommand(id);
      if (cmd && cmd.toggle) {
        btn.classList.toggle("active", isFormatActive(view, id));
      }
    }
  });
}

/**
 * Ensure #main-content wrapper exists for sidebar mode.
 */
function ensureMainContentWrapper() {
  if (document.getElementById("main-content")) return;

  const paneContainer = document.getElementById("pane-container");
  if (!paneContainer) return;

  const wrapper = document.createElement("div");
  wrapper.id = "main-content";
  paneContainer.parentNode.insertBefore(wrapper, paneContainer);
  wrapper.appendChild(paneContainer);
}

/**
 * Remove #main-content wrapper if no sidebar and restore original DOM.
 */
function removeMainContentWrapper() {
  const wrapper = document.getElementById("main-content");
  if (!wrapper) return;

  // Only remove if no format bar sidebar inside
  const sidebar = wrapper.querySelector(".format-bar--sidebar");
  if (sidebar) return;

  const paneContainer = document.getElementById("pane-container");
  if (paneContainer && wrapper.parentNode) {
    wrapper.parentNode.insertBefore(paneContainer, wrapper);
    wrapper.remove();
  }
}

/**
 * Adjust layout heights/widths based on current mode.
 */
function adjustLayout() {
  const paneContainer = document.getElementById("pane-container");
  if (!paneContainer) return;

  const toolbarHeight = 36; // #toolbar
  const statusBarHeight = 24; // #status-bar
  const formatBarHeight = currentMode === "topbar" ? 31 : 0; // 30px + 1px border

  paneContainer.style.height = `calc(100vh - ${toolbarHeight}px - ${statusBarHeight}px - ${formatBarHeight}px)`;

  if (currentMode === "sidebar") {
    ensureMainContentWrapper();
  } else {
    removeMainContentWrapper();
  }
}

// ─── Color Palette ────────────────────────────────────────────────────

const COLOR_PRESETS = [
  // Row 1: basic
  "#cf222e", "#bf8700", "#1a7f37", "#0969da", "#8250df", "#e16f24",
  // Row 2: lighter
  "#ff8182", "#d4a72c", "#4ac26b", "#54aeff", "#c297ff", "#ffa657",
  // Row 3: dark
  "#82071e", "#6c4400", "#044f1e", "#033d8b", "#512a97", "#953800",
  // Row 4: neutral
  "#24292f", "#57606a", "#8b949e", "#d0d7de", "#f6f8fa", "#ffffff",
];

let colorPaletteEl = null;

function showColorPalette(anchorBtn) {
  if (colorPaletteEl) {
    closeColorPalette();
    return;
  }

  colorPaletteEl = document.createElement("div");
  colorPaletteEl.className = "fb-dropdown-overlay";
  colorPaletteEl.style.padding = "8px";
  colorPaletteEl.style.width = "200px";

  // Grid of color swatches
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:4px;";

  COLOR_PRESETS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.style.cssText =
      `width:26px;height:26px;border-radius:4px;border:1px solid #d0d7de;cursor:pointer;background:${color};padding:0;`;
    if (color === "#ffffff") {
      swatch.style.border = "1px solid #8b949e";
    }
    swatch.title = color;
    swatch.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeColorPalette();
      const view = getEditor();
      if (view) {
        insertColor(view, color);
        view.focus();
      }
    });
    grid.appendChild(swatch);
  });

  colorPaletteEl.appendChild(grid);

  // 色履歴セクション（使用履歴があれば表示）
  const history = getColorHistory();
  if (history.length > 0) {
    const histLabel = document.createElement("div");
    histLabel.style.cssText = "font-size:10px;color:#8b949e;margin:6px 0 2px 0;padding:0;";
    histLabel.textContent = t("format.recentColors");
    colorPaletteEl.appendChild(histLabel);

    const histGrid = document.createElement("div");
    histGrid.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:4px;";

    history.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.style.cssText =
        `width:26px;height:26px;border-radius:4px;border:1px solid #d0d7de;cursor:pointer;background:${color};padding:0;`;
      if (color === "#ffffff") swatch.style.border = "1px solid #8b949e";
      swatch.title = color;
      swatch.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeColorPalette();
        const view = getEditor();
        if (view) {
          insertColor(view, color);
          view.focus();
        }
      });
      histGrid.appendChild(swatch);
    });

    colorPaletteEl.appendChild(histGrid);
  }

  // Custom color input row
  const customRow = document.createElement("div");
  customRow.style.cssText = "display:flex;gap:4px;margin-top:6px;align-items:center;";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = "#0969da";
  colorInput.style.cssText = "width:28px;height:24px;padding:0;border:1px solid #d0d7de;border-radius:4px;cursor:pointer;";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText =
    "flex:1;height:24px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;cursor:pointer;font-size:11px;color:#24292f;";
  applyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeColorPalette();
    const view = getEditor();
    if (view) {
      insertColor(view, colorInput.value);
      view.focus();
    }
  });

  customRow.appendChild(colorInput);
  customRow.appendChild(applyBtn);
  colorPaletteEl.appendChild(customRow);

  document.body.appendChild(colorPaletteEl);

  // Position
  const rect = anchorBtn.getBoundingClientRect();
  if (currentMode === "sidebar") {
    colorPaletteEl.style.left = (rect.right + 2) + "px";
    colorPaletteEl.style.top = rect.top + "px";
  } else {
    colorPaletteEl.style.left = rect.left + "px";
    colorPaletteEl.style.top = (rect.bottom + 2) + "px";
  }

  // Boundary check
  const menuRect = colorPaletteEl.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    colorPaletteEl.style.left = (window.innerWidth - menuRect.width - 4) + "px";
  }
  if (menuRect.bottom > window.innerHeight) {
    colorPaletteEl.style.top = (rect.top - menuRect.height - 2) + "px";
  }

  // Close on outside click
  const outsideHandler = (e) => {
    if (colorPaletteEl && !colorPaletteEl.contains(e.target) && e.target !== anchorBtn) {
      closeColorPalette();
      document.removeEventListener("mousedown", outsideHandler);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", outsideHandler), 0);
}

function closeColorPalette() {
  if (colorPaletteEl) {
    colorPaletteEl.remove();
    colorPaletteEl = null;
  }
}
