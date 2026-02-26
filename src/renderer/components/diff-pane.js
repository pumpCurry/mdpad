import { computeDiff } from "../lib/diff-engine.js";
import {
  renderInlineDiff,
  renderSideBySideDiff,
} from "../lib/diff-renderer.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

let diffContainer = null;
let toolbarEl = null;
let contentEl = null;
let diffMode = "history"; // "history", "file", or "git"
let viewMode = "sideBySide"; // "sideBySide" or "inline"
let comparisonFileContent = null;
let comparisonFilePath = null;
let gitAvailable = false; // whether the current file is in a tracked git repo
let gitHeadContent = null; // cached HEAD content for git diff

export function initDiff(container) {
  diffContainer = container;
  renderDiffUI();
  onLocaleChange(() => renderDiffUI());
}

function renderDiffUI() {
  // Preserve existing state but rebuild UI
  const hadToolbar = !!toolbarEl;

  // Remove old elements
  if (toolbarEl) toolbarEl.remove();
  if (contentEl) contentEl.remove();

  // Create toolbar
  toolbarEl = document.createElement("div");
  toolbarEl.className = "diff-toolbar";
  toolbarEl.innerHTML = `
    <select id="diff-mode-select">
      <option value="history" ${diffMode === "history" ? "selected" : ""}>${t("diffPane.editHistory")}</option>
      <option value="file" ${diffMode === "file" ? "selected" : ""}>${t("diffPane.fileCompare")}</option>
      ${gitAvailable ? `<option value="git" ${diffMode === "git" ? "selected" : ""}>${t("diffPane.vsGit")}</option>` : ""}
    </select>
    <button id="diff-open-file" style="display:none">${t("diffPane.openFile")}</button>
    <span id="diff-file-name" style="display:none;color:#57606a;font-size:11px;"></span>
    <div style="flex:1"></div>
    <select id="diff-view-select">
      <option value="sideBySide" ${viewMode === "sideBySide" ? "selected" : ""}>${t("diffPane.sideBySide")}</option>
      <option value="inline" ${viewMode === "inline" ? "selected" : ""}>${t("diffPane.inline")}</option>
    </select>
  `;
  diffContainer.appendChild(toolbarEl);

  // Create content area
  contentEl = document.createElement("div");
  contentEl.className = "diff-content";
  contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.noChanges")}</div>`;
  diffContainer.appendChild(contentEl);

  // Restore file name display
  if (comparisonFilePath) {
    const fileName = comparisonFilePath.split(/[\\/]/).pop();
    toolbarEl.querySelector("#diff-file-name").textContent = fileName;
  }

  // Event listeners
  toolbarEl.querySelector("#diff-mode-select").addEventListener("change", (e) => {
    diffMode = e.target.value;
    updateFileButtonVisibility();
    if (window._mdpadDiffUpdate) window._mdpadDiffUpdate();
  });

  toolbarEl.querySelector("#diff-view-select").addEventListener("change", (e) => {
    viewMode = e.target.value;
    if (window._mdpadDiffUpdate) window._mdpadDiffUpdate();
  });

  toolbarEl.querySelector("#diff-open-file").addEventListener("click", async () => {
    const result = await window.mdpad.openDiffFile();
    if (result) {
      comparisonFileContent = result.content;
      comparisonFilePath = result.path;
      const fileName = result.path.split(/[\\/]/).pop();
      toolbarEl.querySelector("#diff-file-name").textContent = fileName;
      toolbarEl.querySelector("#diff-file-name").style.display = "inline";
      if (window._mdpadDiffUpdate) window._mdpadDiffUpdate();
    }
  });

  updateFileButtonVisibility();
}

function updateFileButtonVisibility() {
  const btn = toolbarEl.querySelector("#diff-open-file");
  const name = toolbarEl.querySelector("#diff-file-name");
  if (diffMode === "file") {
    btn.style.display = "inline-block";
    if (comparisonFilePath) {
      name.style.display = "inline";
    }
  } else {
    btn.style.display = "none";
    name.style.display = "none";
  }
}

export async function updateDiff(currentContent, originalContent) {
  if (!contentEl) return;

  let oldText, newText;

  if (diffMode === "history") {
    oldText = originalContent || "";
    newText = currentContent || "";
  } else if (diffMode === "file") {
    if (!comparisonFileContent) {
      contentEl.innerHTML =
        `<div class="diff-empty">${t("diffPane.selectFile")}</div>`;
      return;
    }
    oldText = comparisonFileContent;
    newText = currentContent || "";
  } else if (diffMode === "git") {
    // Git HEAD comparison
    if (gitHeadContent === null) {
      contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.loadingGit")}</div>`;
      try {
        const currentPath = typeof window.__mdpadGetCurrentFilePath === "function"
          ? window.__mdpadGetCurrentFilePath()
          : null;
        if (!currentPath) {
          contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.gitNoFile")}</div>`;
          return;
        }
        gitHeadContent = await window.mdpad.getGitFileContent(currentPath);
        if (gitHeadContent === null) {
          contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.gitNoContent")}</div>`;
          return;
        }
      } catch {
        contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.gitError")}</div>`;
        return;
      }
    }
    oldText = gitHeadContent;
    newText = currentContent || "";
  }

  if (oldText === newText) {
    contentEl.innerHTML = `<div class="diff-empty">${t("diffPane.noChangesDiff")}</div>`;
    return;
  }

  const diffResult = computeDiff(oldText, newText);

  if (viewMode === "sideBySide") {
    contentEl.innerHTML = renderSideBySideDiff(diffResult);
  } else {
    contentEl.innerHTML = renderInlineDiff(diffResult);
  }
}

export function getDiffMode() {
  return diffMode;
}

/**
 * Set whether git diff is available (file is tracked in a git repo).
 */
export function setDiffGitAvailable(available) {
  const wasAvailable = gitAvailable;
  gitAvailable = available;
  if (!available && diffMode === "git") {
    diffMode = "history";
  }
  if (wasAvailable !== available) {
    renderDiffUI();
  }
}

/**
 * Clear the cached git HEAD content (e.g. on file reload or git change).
 */
export function clearDiffGitHeadCache() {
  gitHeadContent = null;
}
