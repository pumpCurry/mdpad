import { getPaneState, togglePane, setPaneState } from "./pane-manager.js";
import { t, onLocaleChange } from "../../i18n/i18n-renderer.js";

let toolbarEl = null;
let buttonsContainer = null;
let buttons = {};

export function initToolbar() {
  toolbarEl = document.getElementById("toolbar");

  // Create a container for just the toolbar buttons (to avoid destroying global search bar on re-render)
  buttonsContainer = document.createElement("div");
  buttonsContainer.id = "toolbar-buttons";
  toolbarEl.appendChild(buttonsContainer);

  // Add spacer after buttons container
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  toolbarEl.appendChild(spacer);

  renderToolbar();

  // Re-render on locale change
  onLocaleChange(() => renderToolbar());
}

function renderToolbar() {
  buttonsContainer.innerHTML = `
    <button id="btn-editor" title="${t("toolbar.tipEditor")}">${t("toolbar.edit")}</button>
    <button id="btn-preview" title="${t("toolbar.tipPreview")}">${t("toolbar.preview")}</button>
    <button id="btn-diff" title="${t("toolbar.tipDiff")}">${t("toolbar.diff")}</button>
    <div class="separator"></div>
    <button id="btn-edit-preview" title="${t("toolbar.tipEditPreview")}">${t("toolbar.editPreview")}</button>
    <button id="btn-all" title="${t("toolbar.tipAll")}">${t("toolbar.all")}</button>
  `;

  buttons = {
    editor: buttonsContainer.querySelector("#btn-editor"),
    preview: buttonsContainer.querySelector("#btn-preview"),
    diff: buttonsContainer.querySelector("#btn-diff"),
  };

  // Toggle individual panes
  buttons.editor.addEventListener("click", () => {
    togglePane("editor");
    updateButtonStates();
  });
  buttons.preview.addEventListener("click", () => {
    togglePane("preview");
    updateButtonStates();
  });
  buttons.diff.addEventListener("click", () => {
    togglePane("diff");
    updateButtonStates();
  });

  // Preset layouts
  buttonsContainer.querySelector("#btn-edit-preview").addEventListener("click", () => {
    setPaneState({ editor: true, preview: true, diff: false });
    updateButtonStates();
  });

  buttonsContainer.querySelector("#btn-all").addEventListener("click", () => {
    setPaneState({ editor: true, preview: true, diff: true });
    updateButtonStates();
  });

  updateButtonStates();
}

export function updateButtonStates() {
  const state = getPaneState();
  for (const [name, btn] of Object.entries(buttons)) {
    if (btn) btn.classList.toggle("active", state[name]);
  }
}
