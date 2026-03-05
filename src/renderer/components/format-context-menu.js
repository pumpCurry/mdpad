/**
 * format-context-menu.js
 *
 * Right-click context menu for Markdown formatting.
 * Shows toggleable format items with active state checkmarks.
 * Headings shown in a flyout submenu, color shown as a palette.
 */

import { FORMAT_COMMANDS, isFormatActive, getFormatCommand, insertColor } from "./format-commands.js";
import { getEditor } from "./editor-pane.js";
import { t } from "../../i18n/i18n-renderer.js";

let menuEl = null;
let headingSubmenuEl = null;
let colorPaletteEl = null;

const COLOR_PRESETS = [
  "#cf222e", "#bf8700", "#1a7f37", "#0969da", "#8250df", "#e16f24",
  "#ff8182", "#d4a72c", "#4ac26b", "#54aeff", "#c297ff", "#ffa657",
  "#82071e", "#6c4400", "#044f1e", "#033d8b", "#512a97", "#953800",
  "#24292f", "#57606a", "#8b949e", "#d0d7de", "#f6f8fa", "#ffffff",
];

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
      if (headingSubmenuEl && headingSubmenuEl.contains(e.target)) return;
      if (colorPaletteEl && colorPaletteEl.contains(e.target)) return;
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
        menuEl.appendChild(createColorMenuItem());
      } else {
        const cmd = getFormatCommand(itemId);
        if (!cmd) return;
        menuEl.appendChild(createMenuItem(cmd));
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
  closeHeadingSubmenu();
  closeColorPalette();
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function closeHeadingSubmenu() {
  if (headingSubmenuEl) {
    headingSubmenuEl.remove();
    headingSubmenuEl = null;
  }
}

function closeColorPalette() {
  if (colorPaletteEl) {
    colorPaletteEl.remove();
    colorPaletteEl = null;
  }
}

function createMenuItem(cmd) {
  const view = getEditor();
  const item = document.createElement("div");
  item.className = "fcm-item";

  const isActive = view && cmd.toggle ? isFormatActive(view, cmd.id) : false;
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
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    // cmd.fn() → focus() の順序でツールバー（format-toolbar.js）と統一
    // cmd.fn() は view.state.selection を直接読むためフォーカス有無に非依存
    // focus() は dispatch 完了後にユーザー入力を受け付けるための後処理
    const currentView = getEditor();
    if (currentView && cmd.fn) {
      cmd.fn(currentView);
      currentView.focus();
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

  // Arrow indicator
  const arrow = document.createElement("span");
  arrow.className = "fcm-arrow";
  arrow.textContent = "\u25B6";
  container.appendChild(arrow);

  // Show submenu on hover — render to document.body to avoid overflow clipping
  let hoverTimeout = null;

  function showSubmenu() {
    if (headingSubmenuEl) return;

    headingSubmenuEl = document.createElement("div");
    headingSubmenuEl.className = "fcm-submenu";

    for (let i = 1; i <= 6; i++) {
      const cmd = getFormatCommand(`h${i}`);
      if (cmd) {
        headingSubmenuEl.appendChild(createMenuItem(cmd));
      }
    }

    document.body.appendChild(headingSubmenuEl);

    // Position to the right of the heading item
    const itemRect = container.getBoundingClientRect();
    headingSubmenuEl.style.left = (itemRect.right + 2) + "px";
    headingSubmenuEl.style.top = itemRect.top + "px";

    // Viewport boundary check
    const subRect = headingSubmenuEl.getBoundingClientRect();
    if (subRect.right > window.innerWidth) {
      headingSubmenuEl.style.left = (itemRect.left - subRect.width - 2) + "px";
    }
    if (subRect.bottom > window.innerHeight) {
      headingSubmenuEl.style.top = (window.innerHeight - subRect.height - 4) + "px";
    }

    // Close submenu when mouse leaves both the item and submenu
    headingSubmenuEl.addEventListener("mouseleave", () => {
      hoverTimeout = setTimeout(closeHeadingSubmenu, 150);
    });
    headingSubmenuEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
  }

  container.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimeout);
    showSubmenu();
  });
  container.addEventListener("mouseleave", () => {
    hoverTimeout = setTimeout(closeHeadingSubmenu, 150);
  });

  // Prevent click on parent from closing menu
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}

function createColorMenuItem() {
  const container = document.createElement("div");
  container.className = "fcm-item has-submenu";

  // Check (empty)
  const check = document.createElement("span");
  check.className = "fcm-check";
  container.appendChild(check);

  // Icon
  const icon = document.createElement("span");
  icon.className = "fcm-icon";
  icon.textContent = "\uD83C\uDFA8";
  container.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "fcm-label";
  label.textContent = t("format.color");
  container.appendChild(label);

  // Arrow indicator
  const arrow = document.createElement("span");
  arrow.className = "fcm-arrow";
  arrow.textContent = "\u25B6";
  container.appendChild(arrow);

  let hoverTimeout = null;

  function showPalette() {
    if (colorPaletteEl) return;

    colorPaletteEl = document.createElement("div");
    colorPaletteEl.className = "fcm-submenu fcm-color-palette";

    // Grid of color swatches
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:4px;";

    COLOR_PRESETS.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.style.cssText =
        `width:26px;height:26px;border-radius:4px;border:1px solid #d0d7de;cursor:pointer;background:${color};padding:0;`;
      if (color === "#ffffff") swatch.style.border = "1px solid #8b949e";
      swatch.title = color;
      swatch.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        const currentView = getEditor();
        if (currentView) {
          currentView.focus();
          insertColor(currentView, color);
        }
      });
      grid.appendChild(swatch);
    });

    colorPaletteEl.appendChild(grid);

    // Custom color input row
    const customRow = document.createElement("div");
    customRow.style.cssText = "display:flex;gap:4px;margin-top:6px;align-items:center;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = "#0969da";
    colorInput.style.cssText = "width:28px;height:24px;padding:0;border:1px solid #d0d7de;border-radius:4px;cursor:pointer;";
    colorInput.addEventListener("mousedown", (e) => e.stopPropagation());

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText =
      "flex:1;height:24px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;cursor:pointer;font-size:11px;color:#24292f;";
    applyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
      const currentView = getEditor();
      if (currentView) {
        currentView.focus();
        insertColor(currentView, colorInput.value);
      }
    });

    customRow.appendChild(colorInput);
    customRow.appendChild(applyBtn);
    colorPaletteEl.appendChild(customRow);

    document.body.appendChild(colorPaletteEl);

    // Position to the right of the color item
    const itemRect = container.getBoundingClientRect();
    colorPaletteEl.style.left = (itemRect.right + 2) + "px";
    colorPaletteEl.style.top = itemRect.top + "px";

    // Viewport boundary check
    const palRect = colorPaletteEl.getBoundingClientRect();
    if (palRect.right > window.innerWidth) {
      colorPaletteEl.style.left = (itemRect.left - palRect.width - 2) + "px";
    }
    if (palRect.bottom > window.innerHeight) {
      colorPaletteEl.style.top = (window.innerHeight - palRect.height - 4) + "px";
    }

    // Close palette when mouse leaves both the item and palette
    colorPaletteEl.addEventListener("mouseleave", () => {
      hoverTimeout = setTimeout(closeColorPalette, 150);
    });
    colorPaletteEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
  }

  container.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimeout);
    showPalette();
  });
  container.addEventListener("mouseleave", () => {
    hoverTimeout = setTimeout(closeColorPalette, 150);
  });

  // Prevent click on parent from closing menu
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return container;
}
