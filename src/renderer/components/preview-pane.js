import { renderMarkdown } from "../lib/markdown-engine.js";
import { renderMarkdownDiff } from "../lib/markdown-diff.js";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

let previewContainer = null;
let headerEl = null;
let contentEl = null;
let renderTimer = null;
let mermaidCache = new Map();
let mermaidInitialized = false;

// Preview mode: "preview" (normal) or "richDiff" (GitHub-style rendered diff)
let previewMode = "preview";
let currentSource = "";
let originalSource = "";
let diffFileContent = null;
let diffFilePath = null;
let diffSource = "history"; // "history" or "file"

// Base directory for resolving relative paths in preview (set by the editor)
let baseDir = null;

export function initPreview(container) {
  previewContainer = container;
  buildPreviewUI();

  // Initialize mermaid
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
  });
  mermaidInitialized = true;

  // Re-render header on locale change
  onLocaleChange(() => buildPreviewUI());
}

function buildPreviewUI() {
  // Remove old elements
  if (headerEl) headerEl.remove();
  if (contentEl) contentEl.remove();

  // Create header with mode switcher
  headerEl = document.createElement("div");
  headerEl.className = "preview-header";
  headerEl.innerHTML = `
    <div class="preview-tabs">
      <button class="preview-tab ${previewMode === "preview" ? "active" : ""}" data-mode="preview">${t("previewPane.preview")}</button>
      <button class="preview-tab ${previewMode === "richDiff" ? "active" : ""}" data-mode="richDiff">${t("previewPane.richDiff")}</button>
    </div>
    <div class="preview-diff-options" style="${previewMode === "richDiff" ? "display:flex" : "display:none"}">
      <select class="preview-diff-source">
        <option value="history" ${diffSource === "history" ? "selected" : ""}>${t("previewPane.vsOriginal")}</option>
        <option value="file" ${diffSource === "file" ? "selected" : ""}>${t("previewPane.vsFile")}</option>
      </select>
      <button class="preview-diff-open-file" style="${diffSource === "file" ? "display:inline-block" : "display:none"}">${t("previewPane.openFile")}</button>
      <span class="preview-diff-file-name" style="${diffFilePath && diffSource === "file" ? "display:inline" : "display:none"}">${diffFilePath ? diffFilePath.split(/[\\/]/).pop() : ""}</span>
    </div>
  `;
  previewContainer.appendChild(headerEl);

  // Tab click handlers
  headerEl.querySelectorAll(".preview-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      previewMode = tab.dataset.mode;
      headerEl
        .querySelectorAll(".preview-tab")
        .forEach((el) => el.classList.remove("active"));
      tab.classList.add("active");

      const diffOpts = headerEl.querySelector(".preview-diff-options");
      diffOpts.style.display = previewMode === "richDiff" ? "flex" : "none";

      renderCurrent();
    });
  });

  // Diff source selector
  headerEl.querySelector(".preview-diff-source").addEventListener("change", (e) => {
    diffSource = e.target.value;
    updateDiffFileButtonVisibility();
    renderCurrent();
  });

  // Open diff file button
  headerEl.querySelector(".preview-diff-open-file").addEventListener("click", async () => {
    const result = await window.mdpad.openDiffFile();
    if (result) {
      diffFileContent = result.content;
      diffFilePath = result.path;
      const fileName = result.path.split(/[\\/]/).pop();
      headerEl.querySelector(".preview-diff-file-name").textContent = fileName;
      headerEl.querySelector(".preview-diff-file-name").style.display = "inline";
      renderCurrent();
    }
  });

  // Create content wrapper
  contentEl = document.createElement("div");
  contentEl.className = "preview-content";
  const body = document.createElement("div");
  body.className = "markdown-body";
  contentEl.appendChild(body);
  previewContainer.appendChild(contentEl);

  // Re-render content
  renderCurrent();
}

function updateDiffFileButtonVisibility() {
  const btn = headerEl.querySelector(".preview-diff-open-file");
  const name = headerEl.querySelector(".preview-diff-file-name");
  if (diffSource === "file") {
    btn.style.display = "inline-block";
    if (diffFilePath) name.style.display = "inline";
  } else {
    btn.style.display = "none";
    name.style.display = "none";
  }
}

function renderCurrent() {
  if (previewMode === "preview") {
    doRender(currentSource);
  } else {
    doRenderRichDiff();
  }
}

export function updatePreview(markdownSource) {
  currentSource = markdownSource;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderCurrent();
  }, 150);
}

export function updatePreviewImmediate(markdownSource) {
  currentSource = markdownSource;
  renderCurrent();
}

export function setOriginalContent(content) {
  originalSource = content;
}

/**
 * Set the base directory for resolving relative asset paths in preview.
 * Should be called whenever the current file path changes.
 * @param {string|null} filePath - Absolute path to the currently edited file
 */
export function setPreviewBaseDir(filePath) {
  if (filePath) {
    // Extract directory from file path (handle both \ and /)
    const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    baseDir = lastSep >= 0 ? filePath.substring(0, lastSep) : null;
  } else {
    baseDir = null;
  }
}

const SANITIZE_OPTS = {
  ADD_TAGS: [
    "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "msub",
    "mfrac", "mover", "munder", "munderover", "msqrt", "mroot", "mtable",
    "mtr", "mtd", "mtext", "mspace", "annotation",
  ],
  ADD_ATTR: ["data-source-line", "xmlns", "encoding", "display"],
  ALLOW_DATA_ATTR: true,
};

async function doRender(markdownSource) {
  if (!contentEl) return;
  const body = contentEl.querySelector(".markdown-body");
  const rawHtml = renderMarkdown(markdownSource);
  body.innerHTML = DOMPurify.sanitize(rawHtml, SANITIZE_OPTS);
  resolveRelativePaths(body);
  await renderMermaidBlocks(body);
}

async function doRenderRichDiff() {
  if (!contentEl) return;
  const body = contentEl.querySelector(".markdown-body");

  let oldText;
  if (diffSource === "history") {
    oldText = originalSource;
  } else {
    if (!diffFileContent) {
      body.innerHTML = `<div class="md-diff-empty">${t("previewPane.selectFile")}</div>`;
      return;
    }
    oldText = diffFileContent;
  }

  const diffHtml = renderMarkdownDiff(oldText, currentSource);
  body.innerHTML = DOMPurify.sanitize(diffHtml, SANITIZE_OPTS);
  resolveRelativePaths(body);
  await renderMermaidBlocks(body);
}

/**
 * Resolve relative paths in src/href attributes of media elements.
 * Converts relative paths to file:// URLs based on the edited file's directory.
 * Leaves absolute paths, http/https, data: URIs, and # anchors unchanged.
 */
function resolveRelativePaths(container) {
  if (!baseDir) return;

  // Normalize baseDir to forward slashes for file:// URL
  const baseDirUrl = baseDir.replace(/\\/g, "/");

  // Elements with src: img, video, audio, source, embed
  const srcElements = container.querySelectorAll("img[src], video[src], audio[src], source[src], embed[src]");
  for (const el of srcElements) {
    const src = el.getAttribute("src");
    if (!src) continue;
    if (isAbsoluteOrSpecial(src)) continue;
    el.setAttribute("src", `file:///${baseDirUrl}/${src}`);
  }

  // Elements with href that could reference local assets (link, a with local file refs)
  // We only fix <a> tags whose href looks like a local file (not http/https/#)
  // This handles cases like [download](./file.pdf)
  const linkElements = container.querySelectorAll("a[href]");
  for (const el of linkElements) {
    const href = el.getAttribute("href");
    if (!href) continue;
    if (isAbsoluteOrSpecial(href)) continue;
    // Only resolve if it looks like a file reference (has an extension)
    if (/\.\w{1,10}$/.test(href)) {
      el.setAttribute("href", `file:///${baseDirUrl}/${href}`);
    }
  }

  // poster attribute on video
  const posterElements = container.querySelectorAll("video[poster]");
  for (const el of posterElements) {
    const poster = el.getAttribute("poster");
    if (!poster) continue;
    if (isAbsoluteOrSpecial(poster)) continue;
    el.setAttribute("poster", `file:///${baseDirUrl}/${poster}`);
  }
}

/**
 * Check if a path is absolute or a special URI (http, https, data, file, #, //)
 */
function isAbsoluteOrSpecial(path) {
  return /^(https?:|data:|file:|blob:|\/\/|#)/i.test(path) ||
         /^[A-Za-z]:[/\\]/.test(path) ||  // Windows absolute: C:\... or C:/...
         path.startsWith("/");             // Unix absolute
}

async function renderMermaidBlocks(container) {
  if (!mermaidInitialized) return;

  const codeBlocks = container.querySelectorAll("code.language-mermaid");
  for (const block of codeBlocks) {
    const pre = block.parentElement;
    if (!pre || pre.tagName !== "PRE") continue;

    const source = block.textContent;

    if (mermaidCache.has(source)) {
      const div = document.createElement("div");
      div.className = "mermaid-diagram";
      div.innerHTML = mermaidCache.get(source);
      pre.replaceWith(div);
      continue;
    }

    try {
      const id = "mermaid-" + Math.random().toString(36).slice(2, 10);
      const { svg } = await mermaid.render(id, source);
      mermaidCache.set(source, svg);
      const div = document.createElement("div");
      div.className = "mermaid-diagram";
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (err) {
      const div = document.createElement("div");
      div.className = "mermaid-error";
      div.textContent = t("previewPane.mermaidError") + " " + err.message;
      pre.replaceWith(div);
    }
  }
}

export function getPreviewElement() {
  return previewContainer;
}
