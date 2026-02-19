import { getEditor } from "./editor-pane.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";
import {
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

// --- State ---
let searchBarEl = null;
let searchInput = null;
let hitCountEl = null;
let toggles = { editor: true, preview: true, diff: true };
let currentQuery = "";
let debounceTimer = null;
let updateTimer = null;
let dndInsertMode = false; // false = drop opens file (default OFF)

// CodeMirror decoration effect for highlighting search matches
const setSearchHighlights = StateEffect.define();

const searchHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlights)) {
        return effect.value;
      }
    }
    // Map decorations through document changes
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlightMark = Decoration.mark({
  class: "global-search-highlight",
});

let fieldInstalled = false;

function ensureFieldInstalled() {
  if (fieldInstalled) return;
  const editor = getEditor();
  if (!editor) return;
  editor.dispatch({
    effects: StateEffect.appendConfig.of(searchHighlightField),
  });
  fieldInstalled = true;
}

// --- Init ---
export function initGlobalSearch() {
  // Create the search bar DOM
  const toolbar = document.getElementById("toolbar");
  searchBarEl = document.createElement("div");
  searchBarEl.id = "global-search-bar";
  searchBarEl.innerHTML = buildHTML();

  // Insert after toolbar's spacer (at the end, right-aligned)
  toolbar.appendChild(searchBarEl);

  bindEvents();

  // Re-render labels on locale change
  onLocaleChange(() => {
    searchBarEl.innerHTML = buildHTML();
    bindEvents();
    // Restore input value
    searchInput = searchBarEl.querySelector(".gs-input");
    if (currentQuery) {
      searchInput.value = currentQuery;
    }
  });
}

/**
 * Called externally when content changes (editor edit, replace, diff file change, etc.)
 * This replaces the old 500ms polling setInterval.
 * Uses a longer debounce (200ms) to ensure document is settled after replace operations.
 */
export function triggerGlobalSearchUpdate() {
  if (!currentQuery) return;
  // Debounce: 200ms to ensure post-replace DOM/state is settled
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    performSearch();
  }, 200);
}

function buildHTML() {
  return `
    <label class="gs-dnd-toggle" title="${t("dnd.tipInsertMode")}">
      <input type="checkbox" class="gs-dnd-checkbox" ${dndInsertMode ? "checked" : ""} />
      <span class="gs-dnd-label">${t("dnd.insertMode")}</span>
    </label>
    <div class="gs-separator"></div>
    <input type="text" class="gs-input" placeholder="${t("globalSearch.placeholder")}" />
    <div class="gs-toggles">
      <button class="gs-toggle ${toggles.editor ? "active" : ""}" data-pane="editor" title="${t("globalSearch.editor")}">${t("globalSearch.editor")}</button>
      <button class="gs-toggle ${toggles.preview ? "active" : ""}" data-pane="preview" title="${t("globalSearch.preview")}">${t("globalSearch.preview")}</button>
      <button class="gs-toggle ${toggles.diff ? "active" : ""}" data-pane="diff" title="${t("globalSearch.diff")}">${t("globalSearch.diff")}</button>
    </div>
    <span class="gs-hit-count"></span>
  `;
}

function bindEvents() {
  searchInput = searchBarEl.querySelector(".gs-input");
  hitCountEl = searchBarEl.querySelector(".gs-hit-count");

  // DnD insert mode toggle
  const dndCheckbox = searchBarEl.querySelector(".gs-dnd-checkbox");
  if (dndCheckbox) {
    dndCheckbox.addEventListener("change", () => {
      dndInsertMode = dndCheckbox.checked;
    });
  }

  // Input handler with debounce
  searchInput.addEventListener("input", () => {
    currentQuery = searchInput.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch();
    }, 150);
  });

  // Escape key to clear
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      currentQuery = "";
      searchInput.value = "";
      clearAllHighlights();
      hitCountEl.textContent = "";
    }
  });

  // Toggle buttons
  searchBarEl.querySelectorAll(".gs-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pane = btn.dataset.pane;
      const newVal = !toggles[pane];

      // Ensure at least 1 toggle remains active
      const otherActive = Object.entries(toggles)
        .filter(([k]) => k !== pane)
        .some(([, v]) => v);

      if (!newVal && !otherActive) return; // Can't disable the last one

      toggles[pane] = newVal;
      btn.classList.toggle("active", newVal);

      if (currentQuery) {
        performSearch();
      } else {
        clearAllHighlights();
      }
    });
  });
}

function performSearch() {
  if (!currentQuery) {
    clearAllHighlights();
    if (hitCountEl) hitCountEl.textContent = "";
    return;
  }

  let totalHits = 0;
  const query = currentQuery.toLowerCase();

  // 1. Editor pane (source text) - use CodeMirror decorations
  if (toggles.editor) {
    totalHits += highlightEditor(query);
  } else {
    clearEditorHighlights();
  }

  // 2. Preview pane (rendered HTML text content)
  if (toggles.preview) {
    totalHits += highlightInDOM(
      document.querySelector("#preview-pane .preview-content"),
      query
    );
  } else {
    clearDOMHighlights(
      document.querySelector("#preview-pane .preview-content")
    );
  }

  // 3. Diff pane (diff content)
  if (toggles.diff) {
    totalHits += highlightInDOM(
      document.querySelector("#diff-pane .diff-content"),
      query
    );
  } else {
    clearDOMHighlights(document.querySelector("#diff-pane .diff-content"));
  }

  // Update hit count display
  if (hitCountEl) {
    if (totalHits > 0) {
      hitCountEl.textContent = `${totalHits} ${t("globalSearch.hits")}`;
      hitCountEl.classList.remove("no-results");
    } else {
      hitCountEl.textContent = t("globalSearch.noResults");
      hitCountEl.classList.add("no-results");
    }
  }
}

// --- Editor highlighting via CodeMirror decorations ---
function highlightEditor(query) {
  ensureFieldInstalled();
  const editor = getEditor();
  if (!editor) return 0;

  const doc = editor.state.doc;
  const text = doc.toString().toLowerCase();
  const ranges = [];
  let idx = 0;

  while (idx < text.length) {
    const found = text.indexOf(query, idx);
    if (found === -1) break;
    ranges.push(highlightMark.range(found, found + query.length));
    idx = found + 1;
  }

  const decorationSet =
    ranges.length > 0
      ? Decoration.set(ranges, true)
      : Decoration.none;

  editor.dispatch({
    effects: setSearchHighlights.of(decorationSet),
  });

  return ranges.length;
}

function clearEditorHighlights() {
  const editor = getEditor();
  if (!editor || !fieldInstalled) return;
  editor.dispatch({
    effects: setSearchHighlights.of(Decoration.none),
  });
}

// --- DOM highlighting for preview/diff ---
function highlightInDOM(container, query) {
  if (!container) return 0;

  // Clear existing highlights first
  clearDOMHighlights(container);

  // Only search visible panes
  const containerParent = container.closest(".pane");
  if (containerParent && containerParent.style.display === "none") return 0;

  let count = 0;
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent.toLowerCase();
    const original = textNode.textContent;
    if (!text.includes(query)) continue;

    const fragment = document.createDocumentFragment();
    let lastIdx = 0;
    let idx = text.indexOf(query, 0);

    while (idx !== -1) {
      // Text before match
      if (idx > lastIdx) {
        fragment.appendChild(
          document.createTextNode(original.slice(lastIdx, idx))
        );
      }
      // Highlighted match
      const mark = document.createElement("mark");
      mark.className = "global-search-highlight";
      mark.textContent = original.slice(idx, idx + query.length);
      fragment.appendChild(mark);
      count++;
      lastIdx = idx + query.length;
      idx = text.indexOf(query, lastIdx);
    }

    // Remaining text
    if (lastIdx < original.length) {
      fragment.appendChild(
        document.createTextNode(original.slice(lastIdx))
      );
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  return count;
}

function clearDOMHighlights(container) {
  if (!container) return;
  const marks = container.querySelectorAll("mark.global-search-highlight");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize(); // Merge adjacent text nodes
  });
}

function clearAllHighlights() {
  clearEditorHighlights();
  clearDOMHighlights(document.querySelector("#preview-pane .preview-content"));
  clearDOMHighlights(document.querySelector("#diff-pane .diff-content"));
}

/**
 * Returns whether DnD insert mode is active.
 * When false (default), drops anywhere open the file.
 * When true, drops on editor insert content, drops elsewhere open the file.
 */
export function isDndInsertMode() {
  return dndInsertMode;
}
