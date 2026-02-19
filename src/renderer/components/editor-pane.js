import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  keymap,
  ViewPlugin,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
} from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, openSearchPanel, getSearchQuery, SearchCursor, RegExpCursor } from "@codemirror/search";
import {
  indentWithTab,
  history,
  historyKeymap,
  defaultKeymap,
} from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches } from "@codemirror/search";
import { t } from "../../i18n/i18n-renderer.js";

const wrapCompartment = new Compartment();
const closeBracketsCompartment = new Compartment();
let editorView = null;
let onChangeCallback = null;
let wordWrapEnabled = true;
let closeBracketsEnabled = true;

// Ruler plugin: draws a vertical line at a given column using a ViewPlugin
function rulerPlugin(col) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.ruler = document.createElement("div");
        this.ruler.className = "cm-ruler-line";
        this.ruler.style.cssText =
          "position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #d0d7de;pointer-events:none;z-index:1;";
        this.updatePosition(view);
        view.scrollDOM.style.position = "relative";
        view.scrollDOM.appendChild(this.ruler);
      }
      updatePosition(view) {
        const charWidth = view.defaultCharacterWidth;
        const left = charWidth * col;
        this.ruler.style.left = left + "px";
        // Match the height of the content
        this.ruler.style.height = view.contentDOM.offsetHeight + "px";
      }
      update(update) {
        if (
          update.geometryChanged ||
          update.viewportChanged ||
          update.docChanged
        ) {
          this.updatePosition(update.view);
        }
      }
      destroy() {
        this.ruler.remove();
      }
    }
  );
}

// Build search phrases from i18n
function getSearchPhrases() {
  return {
    "Find": t("search.find"),
    "Replace": t("search.replace"),
    "next": t("search.next"),
    "previous": t("search.previous"),
    "all": t("search.all"),
    "match case": t("search.matchCase"),
    "by word": t("search.byWord"),
    "regexp": t("search.regexp"),
    "replace": t("search.replaceBtn"),
    "replace all": t("search.replaceAll"),
    "close": t("search.close"),
  };
}

// --- Search match count tracking ---
let lastSearchQuery = "";
let lastSearchFlags = "";
let lastMatchCount = 0;
let pendingReplacedCount = 0;
let matchInfoTimer = null;
let replacedDisplayTimer = null;

/**
 * ViewPlugin that monitors the CodeMirror search query and counts matches.
 * Injects a match-count display element into the search panel DOM.
 * Automatically detects replace operations by watching count changes
 * when the search query hasn't changed but doc length did.
 */
function searchMatchCountPlugin() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.infoEl = null;
        this.prevQueryStr = "";
        this.prevFlags = "";
        this.prevDocLen = 0;
        this.scheduleCheck();
      }

      update(update) {
        // Check on any doc change or effects (search query change opens panel, etc.)
        if (update.docChanged || update.transactions.some(tr => tr.effects.length > 0)) {
          this.scheduleCheck();
        }
      }

      scheduleCheck() {
        if (matchInfoTimer) clearTimeout(matchInfoTimer);
        matchInfoTimer = setTimeout(() => this.checkAndUpdate(), 50);
      }

      checkAndUpdate() {
        const view = this.view;
        const query = getSearchQuery(view.state);
        const queryStr = query.search || "";
        const flags = `${query.caseSensitive ? "c" : ""}${query.regexp ? "r" : ""}${query.wholeWord ? "w" : ""}`;
        const docLen = view.state.doc.length;

        // Ensure the info element exists in the search panel
        this.ensureInfoElement();

        if (!queryStr || !query.valid) {
          if (this.infoEl) this.infoEl.textContent = "";
          lastSearchQuery = "";
          lastSearchFlags = "";
          lastMatchCount = 0;
          return;
        }

        // Detect what changed
        const queryChanged = queryStr !== this.prevQueryStr || flags !== this.prevFlags;
        const docChanged = docLen !== this.prevDocLen;

        if (!queryChanged && !docChanged) return; // Nothing changed

        const prevCount = lastMatchCount;
        const count = this.countMatches(view, query);

        // Detect replace: same query, doc changed, count decreased
        const isReplace = !queryChanged && docChanged && prevCount > count;

        lastMatchCount = count;
        lastSearchQuery = queryStr;
        lastSearchFlags = flags;
        this.prevQueryStr = queryStr;
        this.prevFlags = flags;
        this.prevDocLen = docLen;

        if (isReplace) {
          const replaced = prevCount - count;
          pendingReplacedCount += replaced;

          // Show replaced info
          this.showReplacedInfo(pendingReplacedCount, count);

          // Reset replaced display after 5 seconds
          if (replacedDisplayTimer) clearTimeout(replacedDisplayTimer);
          replacedDisplayTimer = setTimeout(() => {
            pendingReplacedCount = 0;
            if (this.infoEl && this.view.dom.querySelector(".cm-search")) {
              const currentCount = this.countMatches(this.view, getSearchQuery(this.view.state));
              lastMatchCount = currentCount;
              this.showMatchCount(currentCount);
            }
          }, 5000);
        } else {
          // Normal: query changed or doc changed for non-replace reason
          pendingReplacedCount = 0;
          if (replacedDisplayTimer) clearTimeout(replacedDisplayTimer);
          this.showMatchCount(count);
        }
      }

      countMatches(view, query) {
        const doc = view.state.doc;
        const searchStr = query.search;
        if (!searchStr) return 0;

        let count = 0;
        try {
          if (query.regexp) {
            const cursor = new RegExpCursor(doc, searchStr, { ignoreCase: !query.caseSensitive }, 0, doc.length);
            while (!cursor.next().done) {
              count++;
              if (count > 99999) break; // Safety limit
            }
          } else {
            // Plain text search
            const text = query.caseSensitive ? doc.toString() : doc.toString().toLowerCase();
            const q = query.caseSensitive ? searchStr : searchStr.toLowerCase();
            let idx = 0;
            while (idx < text.length) {
              const found = text.indexOf(q, idx);
              if (found === -1) break;
              count++;
              idx = found + 1;
              if (count > 99999) break;
            }
          }
        } catch {
          // Invalid regex etc.
        }
        return count;
      }

      ensureInfoElement() {
        // Find the CodeMirror search panel
        const panel = this.view.dom.querySelector(".cm-search");
        if (!panel) {
          this.infoEl = null;
          return;
        }
        // Check if our info element already exists
        let existing = panel.querySelector(".cm-search-match-info");
        if (existing) {
          this.infoEl = existing;
          return;
        }
        // Create and insert the info element
        const el = document.createElement("span");
        el.className = "cm-search-match-info";
        // Insert before the close button (last button in panel)
        const closeBtn = panel.querySelector("button[name=close]");
        if (closeBtn) {
          closeBtn.parentNode.insertBefore(el, closeBtn);
        } else {
          panel.appendChild(el);
        }
        this.infoEl = el;
      }

      showMatchCount(count) {
        if (!this.infoEl) return;
        const tmpl = t("search.matchCount");
        this.infoEl.textContent = tmpl.replace("{count}", count);
        this.infoEl.classList.toggle("no-results", count === 0 && lastSearchQuery.length > 0);
        this.infoEl.classList.remove("replaced");
      }

      showReplacedInfo(replaced, count) {
        if (!this.infoEl) return;
        const tmpl = t("search.replacedCount");
        this.infoEl.textContent = tmpl
          .replace("{replaced}", replaced)
          .replace("{count}", count);
        this.infoEl.classList.toggle("no-results", false);
        this.infoEl.classList.add("replaced");
      }

      destroy() {
        if (this.infoEl && this.infoEl.parentNode) {
          this.infoEl.remove();
        }
      }
    }
  );
}

export function createEditor(container, onChange) {
  onChangeCallback = onChange;

  // Build basicSetup manually (without closeBrackets, which goes in a Compartment)
  const extensions = [
    // --- basicSetup components (expanded) ---
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    // closeBrackets in a compartment for toggling
    closeBracketsCompartment.of([closeBrackets(), keymap.of(closeBracketsKeymap)]),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    // --- Custom extensions ---
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    search(),
    EditorState.phrases.of(getSearchPhrases()),
    keymap.of([indentWithTab]),
    wrapCompartment.of(EditorView.lineWrapping),
    rulerPlugin(80),
    searchMatchCountPlugin(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeCallback) {
        onChangeCallback(update.state.doc.toString());
      }
    }),
  ];

  editorView = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions,
    }),
    parent: container,
  });

  return editorView;
}

export function getEditor() {
  return editorView;
}

export function getContent() {
  if (!editorView) return "";
  return editorView.state.doc.toString();
}

export function setContent(text) {
  if (!editorView) return;
  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: text,
    },
  });
}

export function toggleWordWrap() {
  if (!editorView) return;
  wordWrapEnabled = !wordWrapEnabled;
  editorView.dispatch({
    effects: wrapCompartment.reconfigure(
      wordWrapEnabled ? EditorView.lineWrapping : []
    ),
  });
  return wordWrapEnabled;
}

export function toggleCloseBrackets() {
  if (!editorView) return;
  closeBracketsEnabled = !closeBracketsEnabled;
  editorView.dispatch({
    effects: closeBracketsCompartment.reconfigure(
      closeBracketsEnabled ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []
    ),
  });
  return closeBracketsEnabled;
}

export function isCloseBracketsEnabled() {
  return closeBracketsEnabled;
}

export function openSearch() {
  if (!editorView) return;
  openSearchPanel(editorView);
}

export function getCursorInfo() {
  if (!editorView) return { line: 1, col: 1, selected: 0 };
  const state = editorView.state;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const selected = state.selection.main.to - state.selection.main.from;
  return {
    line: line.number,
    col: pos - line.from + 1,
    selected,
    totalLines: state.doc.lines,
  };
}

export function focus() {
  if (editorView) editorView.focus();
}

export function refreshLayout() {
  if (editorView) editorView.requestMeasure();
}
