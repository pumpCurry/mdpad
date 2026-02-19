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
import { search, openSearchPanel } from "@codemirror/search";
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
