/**
 * Automated screenshot capture for mdpad documentation.
 *
 * Launches mdpad with a sample Markdown file, positions the window
 * in the center-right area of a 4K screen (to avoid desktop icons),
 * and captures screenshots of various UI states via CDP.
 *
 * Uses Node.js 22+ built-in WebSocket (no external dependencies).
 *
 * Usage:
 *   node scripts/take-screenshots.js
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

// --- Config ---
const REMOTE_DEBUGGING_PORT = 19333;
const TIMEOUT_LAUNCH = 15000;

const SAMPLE_MD = path.join(__dirname, "screenshot-sample.md");
const OUTPUT_DIR = path.join(__dirname, "..", "docs", "resources");

// Window geometry — centered in the right-center area of a 4K screen
// to avoid desktop icons on the left side
const WIN_X = 1440;
const WIN_Y = 270;
const WIN_W = 1280;
const WIN_H = 900;

// --- Helpers ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function waitForDebugger(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pages = await httpGetJSON(`http://127.0.0.1:${port}/json`);
      const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for DevTools debugger");
}

function killMdpad() {
  try {
    execSync("taskkill /F /IM mdpad.exe /T 2>nul", { stdio: "ignore" });
  } catch {}
}

function resolveExePath() {
  const candidates = ["build16", "build15", "build14", "build13", "build12", "build11", "build10"].map(
    (d) => path.join(__dirname, "..", d, "win-unpacked", "mdpad.exe")
  );
  return candidates.find((p) => fs.existsSync(p));
}

function getUserDataPath() {
  return path.join(os.homedir(), "AppData", "Roaming", "mdpad");
}

// ---------------------------------------------------------------------------
// CDP Session using Node.js 22+ built-in WebSocket
// ---------------------------------------------------------------------------
class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("WebSocket error"));
      this.ws.onmessage = (evt) => {
        const raw = typeof evt.data === "string" ? evt.data : evt.data.toString();
        const msg = JSON.parse(raw);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          JSON.stringify(result.exceptionDetails)
      );
    }
    return result.result?.value;
  }

  async dispatchKey(key, modifiers = 0, keyCode = 0) {
    const params = {
      type: "keyDown",
      key,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await this.send("Input.dispatchKeyEvent", params);
    await this.send("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

const CTRL = 2;

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------
async function captureScreenshot(cdp, filename) {
  const outPath = path.join(OUTPUT_DIR, filename);
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
  });
  fs.writeFileSync(outPath, Buffer.from(result.data, "base64"));
  console.log(`    Saved: ${filename}`);
}

async function positionWindow(cdp) {
  // Use Emulation to set device metrics for consistent screenshot size
  // (Browser domain not available in Electron)
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIN_W,
    height: WIN_H,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Also try to resize via Electron's BrowserWindow API from renderer
  await cdp.evaluate(`
    (() => {
      try {
        const { ipcRenderer } = require('electron');
        // Electron exposes remote or ipcRenderer
      } catch {}
    })()
  `);
}

// Show specific panes using toolbar button IDs
async function showPanes(cdp, showEditor, showPreview, showDiff) {
  await cdp.evaluate(`
    (() => {
      const edBtn = document.getElementById('btn-editor');
      const pvBtn = document.getElementById('btn-preview');
      const dfBtn = document.getElementById('btn-diff');
      // First ensure at least one target pane will be visible
      if (${showEditor} && edBtn && !edBtn.classList.contains('active')) edBtn.click();
      if (${showPreview} && pvBtn && !pvBtn.classList.contains('active')) pvBtn.click();
      if (${showDiff} && dfBtn && !dfBtn.classList.contains('active')) dfBtn.click();
      // Then hide the ones we don't want
      if (!${showEditor} && edBtn && edBtn.classList.contains('active')) edBtn.click();
      if (!${showPreview} && pvBtn && pvBtn.classList.contains('active')) pvBtn.click();
      if (!${showDiff} && dfBtn && dfBtn.classList.contains('active')) dfBtn.click();
    })()
  `);
}

async function scrollToTop(cdp) {
  await cdp.evaluate(`
    (() => {
      const scroller = document.querySelector('.cm-scroller');
      if (scroller) scroller.scrollTop = 0;
      const preview = document.querySelector('.preview-pane .tab-content');
      if (preview) preview.scrollTop = 0;
    })()
  `);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== mdpad Screenshot Capture ===\n");

  const exePath = resolveExePath();
  if (!exePath) {
    console.error("EXE not found. Run 'npm run build' first.");
    process.exit(1);
  }
  console.log(`EXE: ${exePath}`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Kill any existing mdpad
  killMdpad();
  await sleep(1000);

  // Clean recovery files to avoid recovery dialog
  const userData = getUserDataPath();
  for (const subdir of ["sessions", "autosave"]) {
    const dir = path.join(userData, subdir);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  }

  // Launch mdpad with sample file
  console.log("Launching mdpad...");
  const child = spawn(
    exePath,
    [`--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`, "--no-sandbox", SAMPLE_MD],
    { stdio: "ignore", detached: false }
  );

  let exited = false;
  child.on("exit", () => { exited = true; });
  child.on("error", (err) => {
    console.error(`Could not launch EXE: ${err.message}`);
    process.exit(1);
  });

  let cdp = null;
  try {
    // Wait for DevTools
    const page = await waitForDebugger(REMOTE_DEBUGGING_PORT, TIMEOUT_LAUNCH);
    console.log(`Window ready: ${page.url}\n`);

    cdp = new CDPSession(page.webSocketDebuggerUrl);
    await cdp.connect();

    // Position window
    console.log("Positioning window...");
    await positionWindow(cdp);
    await sleep(2000);

    // Wait for content to fully render (Mermaid, KaTeX, etc.)
    await sleep(3000);

    // =================================================================
    // Screenshot 1: Editor only
    // =================================================================
    console.log("[1/8] Editor only...");
    await showPanes(cdp, true, false, false);
    await sleep(1500);
    await scrollToTop(cdp);
    await sleep(500);
    await captureScreenshot(cdp, "01_main_editor.png");
    await captureScreenshot(cdp, "01_main_editor_en.png");

    // =================================================================
    // Screenshot 2: Editor + Preview
    // =================================================================
    console.log("[2/8] Editor + Preview...");
    await showPanes(cdp, true, true, false);
    await sleep(2000);
    await scrollToTop(cdp);
    await sleep(500);
    await captureScreenshot(cdp, "02_edit_preview.png");
    await captureScreenshot(cdp, "02_edit_preview_en.png");

    // =================================================================
    // Screenshot 3: All three panes
    // =================================================================
    console.log("[3/8] All three panes...");
    await showPanes(cdp, true, true, true);
    await sleep(2000);
    await scrollToTop(cdp);
    await sleep(500);
    await captureScreenshot(cdp, "03_all_panes.png");
    await captureScreenshot(cdp, "03_all_panes_en.png");

    // =================================================================
    // Screenshot 4: Search & Replace
    // =================================================================
    console.log("[4/8] Search & Replace...");
    await showPanes(cdp, true, true, false);
    await sleep(500);
    // Open replace panel with Ctrl+H
    await cdp.dispatchKey("h", CTRL, 72);
    await sleep(1000);
    // Type search term via CodeMirror search panel
    await cdp.evaluate(`
      (() => {
        const inputs = document.querySelectorAll('.cm-search input, .cm-search .cm-textfield');
        const searchInput = inputs[0];
        if (searchInput) {
          searchInput.focus();
          // Use native input setter to properly trigger CM events
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(searchInput, 'mdpad');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await sleep(1500);
    await captureScreenshot(cdp, "04_search_replace.png");
    await captureScreenshot(cdp, "04_search_replace_en.png");

    // Close search panel
    await cdp.dispatchKey("Escape", 0, 27);
    await sleep(500);

    // =================================================================
    // Screenshot 5: Cross-pane search
    // =================================================================
    console.log("[5/8] Cross-pane search...");
    await cdp.evaluate(`
      (() => {
        const gsInput = document.getElementById('global-search-input');
        if (gsInput) {
          gsInput.focus();
          gsInput.value = 'Sample';
          gsInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await sleep(1500);
    await captureScreenshot(cdp, "05_global_search.png");
    await captureScreenshot(cdp, "05_global_search_en.png");

    // Clear global search
    await cdp.evaluate(`
      (() => {
        const gsInput = document.getElementById('global-search-input');
        if (gsInput) {
          gsInput.value = '';
          gsInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);

    // =================================================================
    // Screenshot 6: Diff side-by-side
    // =================================================================
    console.log("[6/8] Diff side-by-side...");
    // Add some text to create a diff
    await cdp.evaluate(`
      (() => {
        const view = document.querySelector('.cm-editor')?.cmView?.view;
        if (view) {
          const tr = view.state.update({
            changes: { from: 0, to: 0, insert: "<!-- New line added for diff demo -->\\n\\n" }
          });
          view.dispatch(tr);
        }
      })()
    `);
    await sleep(500);
    // Show all three panes
    await showPanes(cdp, true, true, true);
    await sleep(2000);
    await captureScreenshot(cdp, "06_diff_side_by_side.png");
    await captureScreenshot(cdp, "06_diff_side_by_side_en.png");

    // =================================================================
    // Screenshot 9: Mermaid + KaTeX
    // =================================================================
    console.log("[7/8] Mermaid + KaTeX...");
    await showPanes(cdp, true, true, false);
    await sleep(500);
    // Scroll preview to Mermaid/KaTeX area
    await cdp.evaluate(`
      (() => {
        const previewContent = document.querySelector('.preview-pane .tab-content');
        if (previewContent) {
          const mermaid = previewContent.querySelector('svg[id*="mermaid"], .mermaid, pre code.language-mermaid');
          if (mermaid) {
            mermaid.scrollIntoView({ behavior: 'instant', block: 'start' });
            previewContent.scrollTop = Math.max(0, previewContent.scrollTop - 50);
          }
        }
        // Also scroll editor to match
        const scroller = document.querySelector('.cm-scroller');
        if (scroller) {
          // Find mermaid in editor source — approximately 2/3 down
          scroller.scrollTop = scroller.scrollHeight * 0.5;
        }
      })()
    `);
    await sleep(2000);
    await captureScreenshot(cdp, "09_mermaid_katex.png");
    await captureScreenshot(cdp, "09_mermaid_katex_en.png");

    // =================================================================
    // Screenshot 11: DnD toggle (toolbar overview)
    // =================================================================
    console.log("[8/8] DnD toggle & toolbar...");
    await showPanes(cdp, true, true, false);
    await sleep(500);
    await scrollToTop(cdp);
    await sleep(1000);
    await captureScreenshot(cdp, "11_dnd_toggle.png");

    console.log("\n=== Screenshot capture complete! ===");
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log("\nNote: Menu screenshots (10_menu_file*.png) require manual capture.");

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
  } finally {
    if (cdp) cdp.close();
    killMdpad();
    await sleep(500);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
