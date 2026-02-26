/**
 * format-context-menu.js
 *
 * Right-click context menu for Markdown formatting.
 * Shows toggleable format items with active state checkmarks.
 * Headings shown in a submenu.
 */

import { FORMAT_COMMANDS, isFormatActive, getFormatCommand, insertColor } from "./format-commands.js";
import { getEditor } from "./editor-pane.js";
import { t } from "../../i18n/i18n-renderer.js";

let menuEl = null;

/**
 * Initialize the format context menu.
 * Attaches a contextmenu listener to the editor pane.
 */
export function initFormatContextMenu() {
  const editorPane = document.getElementById("editor-pane");
  if (!editorPane) return;

  editorPane.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  });

  // Close on click outside or Escape
  document.addEventListener("mousedown", (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      closeContextMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl) {
      closeContextMenu();
    }
  });

  // Close when a modal dialog opens
  window.addEventListener("mdpad:closePopups", () => closeContextMenu());
}

function showContextMenu(x, y) {
  closeContextMenu();

  const view = getEditor();
  if (!view) return;

  menuEl = document.createElement("div");
  menuEl.className = "format-context-menu";

  // Build menu structure
  const groups = [
    // Inline
    { items: ["bold", "italic", "underline", "strikethrough", "inlineCode"] },
    // Link / Image
    { items: ["link", "image"] },
    // Headings (submenu)
    { items: ["heading_submenu"] },
    // Lists / Blocks
    { items: ["bulletList", "numberedList", "taskList", "blockquote", "codeBlock"] },
    // Extra blocks
    { items: ["table", "horizontalRule", "details", "definitionList", "kbd", "escape", "color"] },
  ];

  groups.forEach((group, gi) => {
    group.items.forEach((itemId) => {
      if (itemId === "heading_submenu") {
        menuEl.appendChild(createHeadingSubmenu(view));
      } else if (itemId === "color") {
        menuEl.appendChild(createColorMenuItem(view));
      } else {
        const cmd = getFormatCommand(itemId);
        if (!cmd) return;
        menuEl.appendChild(createMenuItem(view, cmd));
      }
    });

    // Add separator between groups (except after last)
    if (gi < groups.length - 1) {
      const sep = document.createElement("div");
      sep.className = "fcm-separator";
      menuEl.appendChild(sep);
    }
  });

  document.body.appendChild(menuEl);

  // Position with viewport boundary checking
  const rect = menuEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (x + rect.width > vw) x = vw - rect.width - 4;
  if (y + rect.height > vh) y = vh - rect.height - 4;
  if (x < 0) x = 4;
  if (y < 0) y = 4;

  menuEl.style.left = x + "px";
  menuEl.style.top = y + "px";
}

function closeContextMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function createMenuItem(view, cmd) {
  const item = document.createElement("div");
  item.className = "fcm-item";

  const isActive = cmd.toggle ? isFormatActive(view, cmd.id) : false;
  if (isActive) item.classList.add("active");

  // Check mark
  const check = document.createElement("span");
  check.className = "fcm-check";
  check.textContent = isActive ? "\u2713" : "";
  item.appendChild(check);

  // Icon
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = cmd.icon;
  if (cmd.iconStyle) icon.style.cssText = cmd.iconStyle;
  item.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t(cmd.i18nKey);
  item.appendChild(label);

  // Shortcut
  if (cmd.shortcut) {
    const shortcut = document.createElement("span");
    shortcut.className = "fcm-shortcut";
    shortcut.textContent = cmd.shortcut;
    item.appendChild(shortcut);
  }

  item.addEventListener("click", (e) => {
    e.stopPropagation();
    closeContextMenu();
    if (cmd.fn) {
      cmd.fn(view);
      view.focus();
    }
  });

  return item;
}

function createHeadingSubmenu(view) {
  const container = document.createElement("div");
  container.className = "fcm-item has-submenu";

  // Check if any heading is active
  let activeHeading = false;
  for (let i = 1; i <= 6; i++) {
    if (isFormatActive(view, `h${i}`)) {
      activeHeading = true;
      break;
    }
  }

  // Check mark
  const check = document.createElement("span");
  check.className = "fcm-check";
  check.textContent = activeHeading ? "\u2713" : "";
  container.appendChild(check);

  // Icon
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = "H";
  icon.style.cssText = "font-weight:bold";
  container.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.heading");
  container.appendChild(label);

  // Submenu
  const submenu = document.createElement("div");
  submenu.className = "fcm-submenu";

  for (let i = 1; i <= 6; i++) {
    const cmd = getFormatCommand(`h${i}`);
    if (cmd) {
      submenu.appendChild(createMenuItem(view, cmd));
    }
  }

  container.appendChild(submenu);

  // Prevent click on parent from closing menu
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}

function createColorMenuItem(view) {
  const item = document.createElement("div");
  item.className = "fcm-item";
  item.style.gap = "6px";

  // Check (empty)
  const check = document.createElement("span");
  check.className = "fcm-check";
  item.appendChild(check);

  // Color input
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = "#0969da";
  colorInput.style.cssText = "width:20px;height:20px;padding:0;border:1px solid #d0d7de;border-radius:3px;cursor:pointer;flex-shrink:0;";

  // Prevent menu close when interacting with color picker
  colorInput.addEventListener("click", (e) => e.stopPropagation());
  colorInput.addEventListener("mousedown", (e) => e.stopPropagation());

  item.appendChild(colorInput);

  // Label
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.color");
  item.appendChild(label);

  item.addEventListener("click", (e) => {
    e.stopPropagation();
    closeContextMenu();
    insertColor(view, colorInput.value);
    view.focus();
  });

  return item;
}
