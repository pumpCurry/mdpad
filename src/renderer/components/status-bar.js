import { getCursorInfo, isOverwriteMode } from "./editor-pane.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

let statusBarEl = null;
let updateTimer = null;
let countdownTimer = null; // 1-second timer for backup countdown
let gitInfo = null; // { repoName, branch, commitHash, commitCount } or null

export function initStatusBar() {
  statusBarEl = document.getElementById("status-bar");
  renderStatusBar();
  onLocaleChange(() => renderStatusBar());

  // Start 1-second countdown refresh for backup remaining time
  countdownTimer = setInterval(updateBackupCountdown, 1000);
}

function renderStatusBar() {
  // Stop old countdown
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  statusBarEl.innerHTML = `
    <span id="sb-cursor" style="cursor:pointer" title="${t("goToLine.title")}">${t("statusBar.ln")} 1, ${t("statusBar.col")} 1</span>
    <span id="sb-selection"></span>
    <span id="sb-lines">0 ${t("statusBar.lines")}</span>
    <span id="sb-ins" style="display:none;color:#cf222e;font-weight:600">&lt;INS&gt;</span>
    <span class="spacer"></span>
    <span id="sb-git" class="sb-git-info" style="display:none"></span>
    <span id="sb-backup" style="width:150px;text-align:center;flex-shrink:0">${t("statusBar.backupOff")}</span>
    <span id="sb-zoom" style="width:55px;text-align:center;flex-shrink:0">100%</span>
    <span id="sb-encoding" style="width:50px;text-align:center;flex-shrink:0">${t("statusBar.encoding")}</span>
    <span id="sb-filetype" style="width:75px;text-align:center;flex-shrink:0">${t("statusBar.filetype")}</span>
  `;

  // Click on cursor info opens Go to Line dialog
  statusBarEl.querySelector("#sb-cursor").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("mdpad:goToLine"));
  });

  // Update git display if info already available
  updateGitStatusDisplay();

  // Restart countdown
  countdownTimer = setInterval(updateBackupCountdown, 1000);
}

/**
 * Convert Electron's zoom level (logarithmic) to a display percentage.
 */
function getZoomPercent() {
  try {
    const level = window.mdpad.getZoomLevel();
    return Math.round(100 * Math.pow(1.2, level));
  } catch {
    return 100;
  }
}

/**
 * Format remaining milliseconds as "Xm Ys" or "Xs".
 */
function formatRemaining(ms) {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Update backup countdown display (called every 1 second).
 */
function updateBackupCountdown() {
  if (!statusBarEl) return;
  const backupEl = statusBarEl.querySelector("#sb-backup");
  if (!backupEl) return;

  const info = typeof window.__mdpadGetAutosaveInfo === "function"
    ? window.__mdpadGetAutosaveInfo()
    : { minutes: 0, nextAt: 0 };

  if (info.minutes <= 0) {
    backupEl.textContent = t("statusBar.backupOff");
    return;
  }

  if (info.nextAt <= 0) {
    // Timer configured but not started yet
    backupEl.textContent = t("statusBar.backupNext").replace("{remaining}", `${info.minutes}m 00s`);
    return;
  }

  const remaining = info.nextAt - Date.now();
  if (remaining <= 0) {
    // About to fire, show 0s briefly
    backupEl.textContent = t("statusBar.backupNext").replace("{remaining}", "0s");
  } else {
    backupEl.textContent = t("statusBar.backupNext").replace("{remaining}", formatRemaining(remaining));
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function updateGitStatusDisplay() {
  if (!statusBarEl) return;
  const gitEl = statusBarEl.querySelector("#sb-git");
  if (!gitEl) return;

  if (!gitInfo) {
    gitEl.style.display = "none";
    return;
  }

  gitEl.style.display = "inline-flex";
  gitEl.innerHTML = `
    <span class="sb-git-repo" title="${t("statusBar.gitRepo")}">${escapeHtml(gitInfo.repoName)}</span>
    <span class="sb-git-branch" title="${t("statusBar.gitBranch")}">${escapeHtml(gitInfo.branch)}</span>
    <span class="sb-git-hash" title="${t("statusBar.gitCommit")}">${escapeHtml(gitInfo.commitHash)}</span>
    <span class="sb-git-count" title="${t("statusBar.gitCommitCount")}">(${gitInfo.commitCount})</span>
  `;
}

export function setGitInfo(info) {
  gitInfo = info;
  updateGitStatusDisplay();
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

    // Update zoom percentage
    const zoomEl = statusBarEl.querySelector("#sb-zoom");
    if (zoomEl) {
      zoomEl.textContent = getZoomPercent() + "%";
    }
  });
}
