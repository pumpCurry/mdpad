import { getCursorInfo, isOverwriteMode } from "./editor-pane.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

let statusBarEl = null;
let updateTimer = null;

export function initStatusBar() {
  statusBarEl = document.getElementById("status-bar");
  renderStatusBar();
  onLocaleChange(() => renderStatusBar());
}

function renderStatusBar() {
  statusBarEl.innerHTML = `
    <span id="sb-cursor" style="cursor:pointer" title="${t("goToLine.title")}">${t("statusBar.ln")} 1, ${t("statusBar.col")} 1</span>
    <span id="sb-selection"></span>
    <span id="sb-lines">0 ${t("statusBar.lines")}</span>
    <span id="sb-ins" style="display:none;color:#cf222e;font-weight:600">&lt;INS&gt;</span>
    <span class="spacer"></span>
    <span id="sb-encoding">${t("statusBar.encoding")}</span>
    <span id="sb-filetype">${t("statusBar.filetype")}</span>
  `;

  // Click on cursor info opens Go to Line dialog
  statusBarEl.querySelector("#sb-cursor").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("mdpad:goToLine"));
  });
}

export function updateStatusBar() {
  if (!statusBarEl) return;
  if (updateTimer) cancelAnimationFrame(updateTimer);
  updateTimer = requestAnimationFrame(() => {
    const info = getCursorInfo();
    const cursorEl = statusBarEl.querySelector("#sb-cursor");
    const selectionEl = statusBarEl.querySelector("#sb-selection");
    const linesEl = statusBarEl.querySelector("#sb-lines");

    cursorEl.textContent = `${t("statusBar.ln")} ${info.line}, ${t("statusBar.col")} ${info.col}`;
    selectionEl.textContent =
      info.selected > 0 ? `(${info.selected} ${t("statusBar.selected")})` : "";
    linesEl.textContent = `${info.totalLines || 0} ${t("statusBar.lines")}`;

    const insEl = statusBarEl.querySelector("#sb-ins");
    if (insEl) {
      insEl.style.display = isOverwriteMode() ? "" : "none";
    }
  });
}
