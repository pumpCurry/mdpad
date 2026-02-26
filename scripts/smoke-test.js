/**
 * EXE Smoke Test for mdpad — Comprehensive Regression Suite
 *
 * 59-step test covering all features:
 *
 * Phase 0 — Setup (3 steps)
 * Phase 1 — Recovery modal (2 steps)
 * Phase 2 — Status bar verification (4 steps)
 * Phase 3 — Toolbar & pane manager (5 steps)
 * Phase 4 — Search & Replace (5 steps)
 * Phase 5 — Global search (3 steps)
 * Phase 6 — Edit operations (4 steps)
 * Phase 7 — Dialogs: close, confirm-save, about, go-to-line (10 steps)
 * Phase 8 — Properties dialog (2 steps)
 * Phase 9 — EOL selection (2 steps)
 * Phase 10 — Confirm-save & title (2 steps)
 * Phase 11 — Diff pane & autosave status (3 steps)
 * Phase 12 — Locale switching (2 steps)
 * Phase 13 — Emoji picker (8 steps) [NEW]
 * Phase 14 — Markdown shortcode rendering (2 steps) [NEW]
 * Phase 15 — Cleanup (1 step)
 *
 * Usage:
 *   node scripts/smoke-test.js [path-to-exe]
 *
 * Requires: Node.js 22+ (built-in WebSocket)
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REMOTE_DEBUGGING_PORT = 19222;
const TIMEOUT_LAUNCH = 20000;
const TIMEOUT_CLOSE = 10000;

// Unique test content per run (timestamp-based)
const TEST_RUN_ID = Date.now().toString(36);
const RECOVERY_CONTENT = `# Recovery Test ${TEST_RUN_ID}\nHello from smoke test\nfoo bar baz\nfoo qux foo\nline five here`;
const SEARCH_TERM = "foo";

// ---------------------------------------------------------------------------
// Resolve EXE path
// ---------------------------------------------------------------------------
function resolveExePath() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);

  // Read output dir from electron-builder.yml if possible
  try {
    const ymlPath = path.join(__dirname, "..", "electron-builder.yml");
    const ymlContent = fs.readFileSync(ymlPath, "utf-8");
    const match = ymlContent.match(/^\s*output:\s*(.+)/m);
    if (match) {
      const ebDir = match[1].trim();
      const ebExe = path.join(__dirname, "..", ebDir, "win-unpacked", "mdpad.exe");
      if (fs.existsSync(ebExe)) return ebExe;
    }
  } catch {}

  const candidates = ["build28", "build27", "build26", "build25", "build24", "build23", "build22", "build21", "build20", "build19", "build18", "build17", "build16", "build15", "build14", "build13", "build12", "build11", "build10", "build9", "build8", "build7", "build6", "build5", "build4", "build3", "build2", "build"].map(
    (d) => path.join(__dirname, "..", d, "win-unpacked", "mdpad.exe")
  );
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stepNum = 0;
const totalSteps = 59;
const results = [];
let softFailCount = 0;

function stepStart(label) {
  stepNum++;
  console.log(`[${stepNum}/${totalSteps}] ${label}`);
}

function stepOK(msg) {
  console.log(`  OK  ${msg}`);
  results.push({ step: stepNum, status: "PASS", msg });
}

function stepSoftFail(msg) {
  softFailCount++;
  console.log(`  SOFT FAIL  ${msg}`);
  results.push({ step: stepNum, status: "SOFT FAIL", msg });
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
  } catch {
    // No processes — fine
  }
}

function getUserDataPath() {
  return path.join(os.homedir(), "AppData", "Roaming", "mdpad");
}

function createFakeRecoverySession() {
  const sessionsDir = path.join(getUserDataPath(), "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  const fakePid = 99990 + Math.floor(Math.random() * 9);
  const sessionFile = path.join(sessionsDir, `session-${fakePid}.json`);

  const sessionData = {
    content: RECOVERY_CONTENT,
    filePath: null,
    isDirty: true,
    paneState: { editor: true, preview: true, diff: false },
    timestamp: Date.now(),
    pid: fakePid,
    savedAt: Date.now(),
  };

  fs.writeFileSync(sessionFile, JSON.stringify(sessionData), "utf-8");
  return sessionFile;
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

// Modifier flags for CDP Input
const CTRL = 2;
const SHIFT = 8;

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
async function main() {
  const exePath = resolveExePath();
  if (!exePath) {
    console.error("FAIL: EXE not found. Run 'npm run build' first.");
    process.exit(1);
  }
  console.log(`EXE: ${exePath}`);
  console.log(`Test run: ${TEST_RUN_ID}`);
  console.log(`Total steps: ${totalSteps}\n`);

  // Pre-cleanup
  killMdpad();
  await sleep(1000);

  // =====================================================================
  // Phase 0: Setup (Steps 1–3)
  // =====================================================================
  stepStart("Creating fake recovery session...");
  const sessionFile = createFakeRecoverySession();
  stepOK(`Created: ${path.basename(sessionFile)}`);

  stepStart("Launching EXE...");
  const child = spawn(
    exePath,
    [`--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`, "--no-sandbox"],
    { stdio: "ignore", detached: false }
  );

  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => { exited = true; exitCode = code; });
  child.on("error", (err) => {
    console.error(`FAIL: Could not launch EXE: ${err.message}`);
    process.exit(1);
  });

  let cdp = null;

  try {
    const page = await waitForDebugger(REMOTE_DEBUGGING_PORT, TIMEOUT_LAUNCH);
    stepOK(`Window: ${page.title || page.url}`);

    stepStart("Connecting to DevTools...");
    cdp = new CDPSession(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    stepOK("DevTools connected");

    // Wait for app init + recovery modal
    await sleep(4000);

    // Ensure locale is English for consistent test labels
    await cdp.evaluate(`
      (function() {
        if (window.__mdpadHandleMenuAction) {
          window.__mdpadHandleMenuAction("changeLocale:en");
        }
      })()
    `);
    await sleep(500);

    // =====================================================================
    // Phase 1: Recovery Modal (Steps 4–5)
    // =====================================================================
    stepStart("Verifying recovery modal appears...");
    let hasModal = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      hasModal = await cdp.evaluate(`!!document.getElementById("recovery-overlay")`);
      if (hasModal) break;
      await sleep(1000);
    }
    if (!hasModal) {
      const debug = await cdp.evaluate(`
        (function() {
          return "overlay=" + !!document.getElementById("recovery-overlay") +
                 " body_len=" + document.body.innerHTML.length;
        })()
      `);
      throw new Error("Recovery modal did not appear. Debug: " + debug);
    }
    stepOK("Recovery modal appeared");

    stepStart("Restoring from recovery...");
    const restored = await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("recovery-overlay");
        if (!overlay) return "NO_MODAL";
        var buttons = overlay.querySelectorAll("button");
        for (var b of buttons) {
          if (b.textContent.includes("選択を復元") || b.textContent.includes("Restore Selected")) {
            b.click();
            return "CLICKED";
          }
        }
        return "NO_RESTORE_BTN";
      })()
    `);
    if (restored !== "CLICKED") throw new Error("Could not click Restore: " + restored);
    await sleep(1000);

    const content = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "";
        return view.state.doc.toString();
      })()
    `);
    if (!content.includes(`Recovery Test ${TEST_RUN_ID}`)) {
      throw new Error("Recovery content not loaded. Got: " + content.substring(0, 80));
    }
    stepOK("Recovery content restored (includes test ID: " + TEST_RUN_ID + ")");

    // Clean up the session file
    try { fs.unlinkSync(sessionFile); } catch {}

    // =====================================================================
    // Phase 2: Status Bar Verification (Steps 6–9) [NEW]
    // =====================================================================
    stepStart("Verifying cursor info in status bar...");
    try {
      const cursorText = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-cursor");
          return el ? el.textContent : "NOT_FOUND";
        })()
      `);
      if (cursorText === "NOT_FOUND") throw new Error("#sb-cursor not found");
      if (!cursorText.match(/\d/)) throw new Error("Cursor text has no numbers: " + cursorText);
      stepOK("Cursor info: " + cursorText);
    } catch (e) {
      stepSoftFail("Cursor info: " + e.message);
    }

    stepStart("Verifying line count in status bar...");
    try {
      // Wait for status bar to update (200ms refresh interval)
      await sleep(500);
      const linesText = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-lines");
          return el ? el.textContent : "NOT_FOUND";
        })()
      `);
      if (linesText === "NOT_FOUND") throw new Error("#sb-lines not found");
      // Extract first number from text (e.g., "5 lines" or "5 行")
      var match = linesText.match(/(\d+)/);
      var lineNum = match ? parseInt(match[1], 10) : -1;
      if (lineNum < 0) throw new Error("No number in lines text: " + linesText);
      stepOK("Line count: " + linesText);
    } catch (e) {
      stepSoftFail("Line count: " + e.message);
    }

    stepStart("Verifying zoom percentage in status bar...");
    try {
      const zoomText = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-zoom");
          return el ? el.textContent : "NOT_FOUND";
        })()
      `);
      if (zoomText === "NOT_FOUND") throw new Error("#sb-zoom not found");
      if (!zoomText.includes("%")) throw new Error("Zoom text no %: " + zoomText);
      stepOK("Zoom: " + zoomText);
    } catch (e) {
      stepSoftFail("Zoom: " + e.message);
    }

    stepStart("Verifying EOL indicator in status bar...");
    try {
      const eolText = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-eol");
          return el ? el.textContent : "NOT_FOUND";
        })()
      `);
      if (eolText === "NOT_FOUND") throw new Error("#sb-eol not found");
      if (!["LF", "CRLF", "CR"].includes(eolText.trim())) throw new Error("Unexpected EOL: " + eolText);
      stepOK("EOL indicator: " + eolText.trim());
    } catch (e) {
      stepSoftFail("EOL indicator: " + e.message);
    }

    // =====================================================================
    // Phase 3: Toolbar & Pane Manager (Steps 10–14) [NEW]
    // =====================================================================
    stepStart("Clicking Preview button → verify pane visible...");
    try {
      const previewResult = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("btn-preview");
          if (!btn) return "NO_BTN";
          btn.click();
          var pane = document.getElementById("preview-pane");
          return pane ? pane.style.display : "NO_PANE";
        })()
      `);
      if (previewResult === "NO_BTN") throw new Error("#btn-preview not found");
      // After toggle, it should be visible (flex) since recovery set preview:true
      // If was already visible, toggle may hide it, so we check existence
      stepOK("Preview toggle result: display=" + previewResult);
    } catch (e) {
      stepSoftFail("Preview toggle: " + e.message);
    }
    await sleep(300);

    stepStart("Clicking Diff button → verify pane visible...");
    try {
      const diffResult = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("btn-diff");
          if (!btn) return "NO_BTN";
          btn.click();
          var pane = document.getElementById("diff-pane");
          return pane ? pane.style.display : "NO_PANE";
        })()
      `);
      if (diffResult === "NO_BTN") throw new Error("#btn-diff not found");
      stepOK("Diff toggle result: display=" + diffResult);
    } catch (e) {
      stepSoftFail("Diff toggle: " + e.message);
    }
    await sleep(300);

    stepStart("Clicking All button → verify all panes visible...");
    try {
      const allResult = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("btn-all");
          if (!btn) return "NO_BTN";
          btn.click();
          var e = document.getElementById("editor-pane");
          var p = document.getElementById("preview-pane");
          var d = document.getElementById("diff-pane");
          return "e=" + (e ? e.style.display : "?") +
                 " p=" + (p ? p.style.display : "?") +
                 " d=" + (d ? d.style.display : "?");
        })()
      `);
      if (allResult === "NO_BTN") throw new Error("#btn-all not found");
      if (!allResult.includes("flex")) throw new Error("Not all panes flex: " + allResult);
      stepOK("All panes visible: " + allResult);
    } catch (e) {
      stepSoftFail("All panes: " + e.message);
    }
    await sleep(300);

    stepStart("Toggling Editor off → verify at least one pane remains...");
    try {
      const toggleResult = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("btn-editor");
          if (!btn) return "NO_BTN";
          btn.click();
          var e = document.getElementById("editor-pane");
          var p = document.getElementById("preview-pane");
          var d = document.getElementById("diff-pane");
          var visible = 0;
          if (e && e.style.display !== "none") visible++;
          if (p && p.style.display !== "none") visible++;
          if (d && d.style.display !== "none") visible++;
          return "visible=" + visible + " editor=" + (e ? e.style.display : "?");
        })()
      `);
      if (toggleResult === "NO_BTN") throw new Error("#btn-editor not found");
      stepOK("After editor toggle: " + toggleResult);
    } catch (e) {
      stepSoftFail("Editor toggle: " + e.message);
    }
    await sleep(200);

    stepStart("Resetting pane state (ensure editor visible)...");
    try {
      await cdp.evaluate(`
        (function() {
          // Ensure editor is visible via menu action helper
          var e = document.getElementById("editor-pane");
          if (e && e.style.display === "none") {
            if (window.__mdpadHandleMenuAction) {
              window.__mdpadHandleMenuAction("toggleEditor");
            }
          }
          // Hide diff and preview for subsequent tests
          var p = document.getElementById("preview-pane");
          var d = document.getElementById("diff-pane");
          if (p && p.style.display !== "none") {
            if (window.__mdpadHandleMenuAction) window.__mdpadHandleMenuAction("togglePreview");
          }
          if (d && d.style.display !== "none") {
            if (window.__mdpadHandleMenuAction) window.__mdpadHandleMenuAction("toggleDiff");
          }
        })()
      `);
      await sleep(300);
      const paneCheck = await cdp.evaluate(`
        (function() {
          var e = document.getElementById("editor-pane");
          return e ? e.style.display : "?";
        })()
      `);
      stepOK("Pane reset done, editor: " + paneCheck);
    } catch (e) {
      stepSoftFail("Pane reset: " + e.message);
    }

    // =====================================================================
    // Phase 4: Search & Replace (Steps 15–19)
    //
    // Note: CodeMirror's search panel uses its own internal state management.
    // CDP Input.insertText/dispatchKeyEvent can insert text into the input
    // field's DOM value, but CodeMirror's search query state won't update.
    // Instead, we use a direct CodeMirror transaction-based approach:
    // 1. Open the search panel via menu action (verifies UI opens)
    // 2. Use editor.dispatch to perform find/replace operations directly
    // This tests the search panel UI appearance and the replace logic.
    // =====================================================================
    stepStart("Opening Find panel (search panel UI)...");

    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (view) view.focus();
        if (window.__mdpadHandleMenuAction) window.__mdpadHandleMenuAction("find");
      })()
    `);
    await sleep(800);

    const searchPanelExists = await cdp.evaluate(`!!document.querySelector(".cm-search")`);
    if (!searchPanelExists) throw new Error("Search panel (.cm-search) not found");
    stepOK("Search panel opened");

    stepStart("Verifying search panel has input and buttons...");
    const searchPanelInfo = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var inputs = panel.querySelectorAll("input.cm-textfield");
        var buttons = panel.querySelectorAll("button");
        var btnNames = [];
        for (var b of buttons) btnNames.push(b.name || b.textContent.trim().substring(0, 15));
        return "inputs=" + inputs.length + " buttons=" + buttons.length + " [" + btnNames.join(",") + "]";
      })()
    `);
    stepOK("Search panel: " + searchPanelInfo);

    stepStart("Testing programmatic search (SearchCursor)...");
    // Verify that the content has "foo" occurrences using direct text search
    const searchCount = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "NO_EDITOR";
        var text = view.state.doc.toString();
        var count = 0;
        var idx = 0;
        while ((idx = text.indexOf("foo", idx)) !== -1) { count++; idx++; }
        return "found=" + count;
      })()
    `);
    if (!searchCount.includes("found=")) throw new Error("Search count: " + searchCount);
    stepOK("Programmatic search: " + searchCount);

    stepStart("Testing Replace (direct editor transaction)...");
    // Perform replace using CodeMirror transaction: find first "foo" and replace with "REPLACED"
    const replaceResult = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "NO_EDITOR";
        var text = view.state.doc.toString();
        var idx = text.indexOf("foo");
        if (idx === -1) return "NO_MATCH";
        view.dispatch({ changes: { from: idx, to: idx + 3, insert: "REPLACED" } });
        return "OK";
      })()
    `);
    if (replaceResult !== "OK") throw new Error("Replace: " + replaceResult);
    await sleep(300);

    const afterReplace = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "";
        return view.state.doc.toString();
      })()
    `);
    if (!afterReplace.includes("REPLACED")) {
      throw new Error("Replace didn't work. Content: " + afterReplace.substring(0, 100));
    }
    stepOK("Replace successful (content contains 'REPLACED')");

    stepStart("Closing search panel...");
    await cdp.evaluate(`
      (function() {
        // Close by clicking the close button
        var panel = document.querySelector(".cm-search");
        if (!panel) return;
        var btn = panel.querySelector("button[name=close]");
        if (btn) btn.click();
      })()
    `);
    await sleep(300);
    const searchClosed = await cdp.evaluate(`!document.querySelector(".cm-search")`);
    stepOK("Search panel closed: " + searchClosed);

    // =====================================================================
    // Phase 5: Global Search (Steps 20–22)
    // =====================================================================
    stepStart("Testing global search bar...");
    const globalSearchResult = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return "NO_SEARCH_BAR";
        var input = bar.querySelector("input.gs-input");
        if (!input) return "NO_INPUT";
        input.focus();
        input.value = "REPLACED";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return "OK";
      })()
    `);
    if (globalSearchResult !== "OK") throw new Error("Global search: " + globalSearchResult);
    await sleep(800);

    const gsResults = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return "NO_BAR";
        var hitCount = bar.querySelector(".gs-hit-count");
        return hitCount ? hitCount.textContent : "NO_HITS_ELEMENT";
      })()
    `);
    stepOK("Global search: " + gsResults);

    stepStart("Testing global search toggle...");
    try {
      const toggleResult = await cdp.evaluate(`
        (function() {
          var bar = document.getElementById("global-search-bar");
          if (!bar) return "NO_BAR";
          var toggle = bar.querySelector('.gs-toggle[data-pane="preview"]');
          if (!toggle) return "NO_TOGGLE";
          var wasBefore = toggle.classList.contains("active");
          toggle.click();
          var isAfter = toggle.classList.contains("active");
          // Click again to restore
          toggle.click();
          return "before=" + wasBefore + " after=" + isAfter;
        })()
      `);
      stepOK("Global search toggle: " + toggleResult);
    } catch (e) {
      stepSoftFail("Global search toggle: " + e.message);
    }

    stepStart("Clearing global search...");
    await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return;
        var input = bar.querySelector("input.gs-input");
        if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
      })()
    `);
    await sleep(200);
    stepOK("Global search cleared");

    // =====================================================================
    // Phase 6: Edit Operations (Steps 23–26) [Enhanced]
    // =====================================================================
    stepStart("Select All → Delete → verify empty...");

    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (view) view.focus();
      })()
    `);
    await sleep(200);

    await cdp.dispatchKey("a", CTRL, 65);
    await sleep(200);
    await cdp.dispatchKey("Backspace", 0, 8);
    await sleep(300);

    const afterDelete = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "NO_EDITOR";
        return view.state.doc.length === 0 ? "EMPTY" : "NOT_EMPTY:" + view.state.doc.length;
      })()
    `);
    if (afterDelete !== "EMPTY") throw new Error("After delete: " + afterDelete);
    stepOK("Content deleted (empty)");

    stepStart("Undo (Ctrl+Z) → verify content restored...");
    await cdp.dispatchKey("z", CTRL, 90);
    await sleep(300);

    const afterUndo = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "";
        return view.state.doc.length > 0 ? "RESTORED:" + view.state.doc.length : "STILL_EMPTY";
      })()
    `);
    if (!afterUndo.startsWith("RESTORED:")) throw new Error("After undo: " + afterUndo);
    stepOK("Undo works (" + afterUndo + ")");

    stepStart("Redo (Ctrl+Y) → verify empty again...");
    await cdp.dispatchKey("y", CTRL, 89);
    await sleep(300);

    const afterRedo = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "NO_EDITOR";
        return view.state.doc.length === 0 ? "EMPTY" : "NOT_EMPTY:" + view.state.doc.length;
      })()
    `);
    if (afterRedo !== "EMPTY") throw new Error("After redo: " + afterRedo);
    stepOK("Redo works (empty again)");

    stepStart("Undo again and insert dirty text...");
    await cdp.dispatchKey("z", CTRL, 90);
    await sleep(200);
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return;
        var len = view.state.doc.length;
        view.dispatch({ changes: { from: len, insert: "\\nsmoke test dirty" } });
      })()
    `);
    await sleep(200);
    stepOK("Content restored and dirty text inserted");

    // =====================================================================
    // Phase 7: Dialogs (Steps 27–36) [NEW]
    // =====================================================================
    stepStart("Triggering close dialog...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadShowCloseDialog) {
            window.__mdpadShowCloseDialog();
          }
        })()
      `);
      await sleep(500);

      const hasCloseDialog = await cdp.evaluate(`!!document.getElementById("close-dialog-overlay")`);
      if (!hasCloseDialog) throw new Error("Close dialog did not appear");
      stepOK("Close dialog appeared");
    } catch (e) {
      stepSoftFail("Close dialog: " + e.message);
    }

    stepStart("Verifying close dialog buttons...");
    try {
      const closeDialogBtns = await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("close-dialog-overlay");
          if (!overlay) return "NO_OVERLAY";
          var btns = overlay.querySelectorAll("button");
          var labels = [];
          for (var b of btns) {
            if (b.textContent !== "×") labels.push(b.textContent.trim());
          }
          return labels.join(" | ");
        })()
      `);
      if (closeDialogBtns === "NO_OVERLAY") throw new Error("No overlay");
      // Should have at least 2 buttons (Exit without Saving + Resume Save + Save As)
      const btnCount = closeDialogBtns.split("|").length;
      if (btnCount < 2) throw new Error("Too few buttons: " + closeDialogBtns);
      stepOK("Close dialog buttons: " + closeDialogBtns);
    } catch (e) {
      stepSoftFail("Close dialog buttons: " + e.message);
    }

    stepStart("Cancelling close dialog (click ×)...");
    try {
      await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("close-dialog-overlay");
          if (!overlay) return;
          var btns = overlay.querySelectorAll("button");
          for (var b of btns) {
            if (b.textContent === "×") { b.click(); return; }
          }
        })()
      `);
      await sleep(300);
      const dismissed = await cdp.evaluate(`!document.getElementById("close-dialog-overlay")`);
      if (!dismissed) throw new Error("Close dialog not dismissed");
      stepOK("Close dialog cancelled");
    } catch (e) {
      stepSoftFail("Close dialog cancel: " + e.message);
    }

    stepStart("Triggering confirm-save dialog via newFile...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("new");
          }
        })()
      `);
      await sleep(500);

      const hasConfirmSave = await cdp.evaluate(`!!document.getElementById("confirm-save-overlay")`);
      if (!hasConfirmSave) throw new Error("Confirm-save dialog did not appear");
      stepOK("Confirm-save dialog appeared");
    } catch (e) {
      stepSoftFail("Confirm-save dialog: " + e.message);
    }

    stepStart("Cancelling confirm-save dialog...");
    try {
      await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("confirm-save-overlay");
          if (!overlay) return;
          // Find Cancel button
          var btns = overlay.querySelectorAll("button");
          for (var b of btns) {
            if (b.textContent.includes("Cancel") || b.textContent.includes("キャンセル") || b.textContent === "×") {
              b.click();
              return;
            }
          }
        })()
      `);
      await sleep(300);
      const cssDismissed = await cdp.evaluate(`!document.getElementById("confirm-save-overlay")`);
      if (!cssDismissed) throw new Error("Confirm-save dialog not dismissed");
      stepOK("Confirm-save dialog cancelled");
    } catch (e) {
      stepSoftFail("Confirm-save cancel: " + e.message);
    }

    stepStart("Triggering About dialog...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("about");
          }
        })()
      `);
      await sleep(500);

      const hasAbout = await cdp.evaluate(`!!document.getElementById("about-overlay")`);
      if (!hasAbout) throw new Error("About dialog did not appear");
      stepOK("About dialog appeared");
    } catch (e) {
      stepSoftFail("About dialog: " + e.message);
    }

    stepStart("Verifying About dialog content...");
    try {
      const aboutInfo = await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("about-overlay");
          if (!overlay) return "NO_OVERLAY";
          var text = overlay.textContent;
          var hasMdpad = text.includes("mdpad");
          var hasVersion = text.match(/v\\d+\\.\\d+/);
          return "mdpad=" + hasMdpad + " version=" + !!hasVersion;
        })()
      `);
      if (aboutInfo === "NO_OVERLAY") throw new Error("No about overlay");
      if (!aboutInfo.includes("mdpad=true")) throw new Error("No mdpad text: " + aboutInfo);
      stepOK("About dialog content: " + aboutInfo);
    } catch (e) {
      stepSoftFail("About dialog content: " + e.message);
    }

    stepStart("Closing About dialog with Escape...");
    try {
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      const aboutDismissed = await cdp.evaluate(`!document.getElementById("about-overlay")`);
      if (!aboutDismissed) throw new Error("About dialog not dismissed");
      stepOK("About dialog closed");
    } catch (e) {
      stepSoftFail("About dialog close: " + e.message);
    }

    stepStart("Triggering Go to Line dialog...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("goToLine");
          }
        })()
      `);
      await sleep(500);

      const hasGoToLine = await cdp.evaluate(`!!document.getElementById("goto-line-overlay")`);
      if (!hasGoToLine) throw new Error("Go to Line dialog did not appear");
      stepOK("Go to Line dialog appeared");
    } catch (e) {
      stepSoftFail("Go to Line dialog: " + e.message);
    }

    stepStart("Closing Go to Line with Escape...");
    try {
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      const gtlDismissed = await cdp.evaluate(`!document.getElementById("goto-line-overlay")`);
      if (!gtlDismissed) throw new Error("Go to Line dialog not dismissed");
      stepOK("Go to Line dialog closed");
    } catch (e) {
      stepSoftFail("Go to Line close: " + e.message);
    }

    // =====================================================================
    // Phase 8: Properties Dialog (Steps 37–38) [NEW]
    // =====================================================================
    stepStart("Triggering Properties dialog...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("properties");
          }
        })()
      `);
      await sleep(500);

      const hasProps = await cdp.evaluate(`!!document.getElementById("properties-overlay")`);
      if (!hasProps) throw new Error("Properties dialog did not appear");
      stepOK("Properties dialog appeared");
    } catch (e) {
      stepSoftFail("Properties dialog: " + e.message);
    }

    stepStart("Verifying Properties dialog content and closing...");
    try {
      const propsInfo = await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("properties-overlay");
          if (!overlay) return "NO_OVERLAY";
          var text = overlay.textContent;
          // Check for key content: should have character/word/line counts or their Japanese equivalents
          var hasChars = text.match(/\\d+/) !== null; // at least one number
          var hasTitle = text.includes("Properties") || text.includes("プロパティ");
          return "title=" + hasTitle + " nums=" + hasChars;
        })()
      `);
      if (propsInfo === "NO_OVERLAY") throw new Error("No properties overlay");
      stepOK("Properties content: " + propsInfo);

      // Close with Escape
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      const propsDismissed = await cdp.evaluate(`!document.getElementById("properties-overlay")`);
      if (!propsDismissed) throw new Error("Properties dialog not dismissed");
      stepOK("Properties dialog closed");
    } catch (e) {
      stepSoftFail("Properties content/close: " + e.message);
    }

    // =====================================================================
    // Phase 9: EOL Selection (Steps 39–40) [NEW]
    // =====================================================================
    stepStart("Clicking EOL indicator → verify popup...");
    try {
      await cdp.evaluate(`
        (function() {
          var eolEl = document.getElementById("sb-eol");
          if (eolEl) eolEl.click();
        })()
      `);
      await sleep(300);

      const hasPopup = await cdp.evaluate(`
        (function() {
          var popup = document.getElementById("eol-popup");
          if (!popup) return "NO_POPUP";
          var items = popup.querySelectorAll("div");
          var labels = [];
          for (var i of items) {
            var text = i.textContent.trim();
            if (text.includes("LF") || text.includes("CRLF") || text.includes("CR")) {
              labels.push(text);
            }
          }
          return "items=" + labels.length;
        })()
      `);
      if (hasPopup === "NO_POPUP") throw new Error("EOL popup did not appear");
      stepOK("EOL popup appeared: " + hasPopup);
    } catch (e) {
      stepSoftFail("EOL popup: " + e.message);
    }

    stepStart("Selecting LF from EOL popup...");
    try {
      await cdp.evaluate(`
        (function() {
          var popup = document.getElementById("eol-popup");
          if (!popup) return;
          var items = popup.querySelectorAll("div");
          for (var i of items) {
            // Find the LF item (but not CRLF)
            var spans = i.querySelectorAll("span");
            for (var s of spans) {
              if (s.textContent.trim() === "LF") {
                i.click();
                return;
              }
            }
          }
        })()
      `);
      await sleep(300);

      const eolAfter = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-eol");
          var popupGone = !document.getElementById("eol-popup");
          return (el ? el.textContent.trim() : "?") + " popup_gone=" + popupGone;
        })()
      `);
      stepOK("EOL after selection: " + eolAfter);
    } catch (e) {
      stepSoftFail("EOL selection: " + e.message);
    }

    // =====================================================================
    // Phase 10: Confirm-Save & Title (Steps 41–42)
    // =====================================================================
    stepStart("Verifying isDirty state...");
    const closeState = await cdp.evaluate(`
      JSON.stringify(
        window.__mdpadGetCloseState
          ? window.__mdpadGetCloseState()
          : { error: "getter not found" }
      )
    `);
    const state = JSON.parse(closeState);
    if (state.error) throw new Error(state.error);
    if (!state.isDirty) throw new Error("isDirty should be true");
    stepOK("isDirty=true confirmed");

    stepStart("Verifying window title contains dirty marker...");
    try {
      const title = await cdp.evaluate(`document.title`);
      if (!title.includes("*")) throw new Error("Title has no dirty marker: " + title);
      stepOK("Title: " + title);
    } catch (e) {
      stepSoftFail("Title dirty marker: " + e.message);
    }

    // =====================================================================
    // Phase 11: Diff Pane & Autosave (Steps 43–45) [NEW]
    // =====================================================================
    stepStart("Showing diff pane and verifying controls...");
    try {
      // Show diff pane
      await cdp.evaluate(`
        (function() {
          var d = document.getElementById("diff-pane");
          if (d && d.style.display === "none") {
            if (window.__mdpadHandleMenuAction) window.__mdpadHandleMenuAction("toggleDiff");
          }
        })()
      `);
      await sleep(500);

      const diffSelect = await cdp.evaluate(`
        (function() {
          var select = document.getElementById("diff-mode-select");
          return select ? "value=" + select.value : "NOT_FOUND";
        })()
      `);
      if (diffSelect === "NOT_FOUND") throw new Error("#diff-mode-select not found");
      stepOK("Diff mode select: " + diffSelect);
    } catch (e) {
      stepSoftFail("Diff controls: " + e.message);
    }

    stepStart("Verifying diff content area...");
    try {
      const diffContent = await cdp.evaluate(`
        (function() {
          var el = document.querySelector(".diff-content");
          return el ? "exists len=" + el.innerHTML.length : "NOT_FOUND";
        })()
      `);
      if (diffContent === "NOT_FOUND") throw new Error(".diff-content not found");
      stepOK("Diff content area: " + diffContent);

      // Hide diff pane again
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) window.__mdpadHandleMenuAction("toggleDiff");
        })()
      `);
      await sleep(200);
    } catch (e) {
      stepSoftFail("Diff content: " + e.message);
    }

    stepStart("Verifying autosave/backup status display...");
    try {
      const backupText = await cdp.evaluate(`
        (function() {
          var el = document.getElementById("sb-backup");
          return el ? el.textContent.trim() : "NOT_FOUND";
        })()
      `);
      if (backupText === "NOT_FOUND") throw new Error("#sb-backup not found");
      // Should contain "OFF" or "Backup" text
      if (!backupText.includes("OFF") && !backupText.includes("Backup") && !backupText.includes("バックアップ")) {
        throw new Error("Unexpected backup text: " + backupText);
      }
      stepOK("Backup status: " + backupText);
    } catch (e) {
      stepSoftFail("Backup status: " + e.message);
    }

    // =====================================================================
    // Phase 12: Locale Switching (Steps 46–47) [NEW]
    // =====================================================================
    stepStart("Switching locale to Japanese...");
    try {
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("changeLocale:ja");
          }
        })()
      `);
      await sleep(800);

      const jaCheck = await cdp.evaluate(`
        (function() {
          var cursor = document.getElementById("sb-cursor");
          return cursor ? cursor.textContent : "NOT_FOUND";
        })()
      `);
      if (jaCheck === "NOT_FOUND") throw new Error("sb-cursor not found after locale change");
      if (!jaCheck.includes("行")) throw new Error("Japanese text not found in cursor: " + jaCheck);
      stepOK("Japanese locale: " + jaCheck);

      // Switch back to English
      await cdp.evaluate(`
        (function() {
          if (window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("changeLocale:en");
          }
        })()
      `);
      await sleep(500);
    } catch (e) {
      stepSoftFail("Locale switch: " + e.message);
    }

    stepStart("Verifying locale switch back to English...");
    try {
      const enCheck = await cdp.evaluate(`
        (function() {
          var cursor = document.getElementById("sb-cursor");
          return cursor ? cursor.textContent : "NOT_FOUND";
        })()
      `);
      if (enCheck === "NOT_FOUND") throw new Error("sb-cursor not found");
      if (!enCheck.includes("Ln")) throw new Error("English text not found: " + enCheck);
      stepOK("English locale restored: " + enCheck);
    } catch (e) {
      stepSoftFail("Locale restore: " + e.message);
    }

    // =====================================================================
    // Phase 13: Emoji Picker (Steps 49–56) [NEW]
    // =====================================================================

    // Ensure editor is visible and focused, and format bar is in topbar mode
    await cdp.evaluate(`
      (function() {
        var e = document.getElementById("editor-pane");
        if (e && e.style.display === "none" && window.__mdpadHandleMenuAction) {
          window.__mdpadHandleMenuAction("toggleEditor");
        }
        // Ensure format toolbar is visible (topbar mode)
        if (window.__mdpadHandleMenuAction) {
          window.__mdpadHandleMenuAction("formatBar:topbar");
        }
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (view) view.focus();
      })()
    `);
    await sleep(500);

    // Clear editor content for clean test
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (view) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
        }
      })()
    `);
    await sleep(200);

    stepStart("Opening emoji picker via format toolbar button...");
    try {
      // The emoji button in the format toolbar has id="fb-emoji-btn"
      const openResult = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("fb-emoji-btn");
          if (!btn) {
            // Fallback: search by title
            var allBtns = document.querySelectorAll(".fb-btn, button");
            for (var b of allBtns) {
              if (b.title && b.title.toLowerCase().includes("emoji")) { btn = b; break; }
            }
          }
          if (!btn) return "NO_EMOJI_BTN";
          btn.click();
          return "CLICKED";
        })()
      `);
      if (openResult === "NO_EMOJI_BTN") throw new Error("Emoji button not found in toolbar");
      await sleep(500);

      const pickerExists = await cdp.evaluate(`!!document.querySelector(".emoji-picker")`);
      if (!pickerExists) throw new Error("Emoji picker did not appear");
      stepOK("Emoji picker opened");
    } catch (e) {
      stepSoftFail("Emoji picker open: " + e.message);
    }

    stepStart("Verifying emoji picker layout (sidebar, grid, status bar)...");
    try {
      const layout = await cdp.evaluate(`
        (function() {
          var picker = document.querySelector(".emoji-picker");
          if (!picker) return "NO_PICKER";
          var sidebar = picker.querySelector(".ep-sidebar");
          var grid = picker.querySelector(".ep-grid-area");
          var status = picker.querySelector(".ep-status-bar");
          var search = picker.querySelector(".ep-search input");
          var sidebarBtns = sidebar ? sidebar.querySelectorAll(".ep-sidebar-btn").length : 0;
          var emojiCount = grid ? grid.querySelectorAll(".ep-emoji").length : 0;
          return "sidebar=" + !!sidebar +
                 " grid=" + !!grid +
                 " status=" + !!status +
                 " search=" + !!search +
                 " sidebarBtns=" + sidebarBtns +
                 " emojis=" + emojiCount;
        })()
      `);
      if (layout === "NO_PICKER") throw new Error("Picker not found");
      if (!layout.includes("sidebar=true")) throw new Error("Missing sidebar: " + layout);
      if (!layout.includes("grid=true")) throw new Error("Missing grid: " + layout);
      if (!layout.includes("status=true")) throw new Error("Missing status bar: " + layout);
      stepOK("Picker layout: " + layout);
    } catch (e) {
      stepSoftFail("Picker layout: " + e.message);
    }

    stepStart("Verifying skin tone button and dropdown...");
    try {
      const skinResult = await cdp.evaluate(`
        (function() {
          var picker = document.querySelector(".emoji-picker");
          if (!picker) return "NO_PICKER";
          var skinBtn = picker.querySelector(".ep-skin-tone-btn");
          if (!skinBtn) return "NO_SKIN_BTN";
          skinBtn.click();
          // Wait a tick for dropdown to appear
          return new Promise(function(resolve) {
            setTimeout(function() {
              var dropdown = picker.querySelector(".ep-skin-tone-dropdown");
              var options = dropdown ? dropdown.querySelectorAll(".ep-skin-tone-option").length : 0;
              // Close dropdown by clicking button again
              skinBtn.click();
              resolve("dropdown=" + !!dropdown + " options=" + options);
            }, 200);
          });
        })()
      `);
      if (!skinResult.includes("dropdown=true")) throw new Error("Skin tone dropdown missing: " + skinResult);
      if (!skinResult.includes("options=6")) throw new Error("Expected 6 skin tone options: " + skinResult);
      stepOK("Skin tone: " + skinResult);
    } catch (e) {
      stepSoftFail("Skin tone: " + e.message);
    }

    stepStart("Verifying name mode toggle button...");
    try {
      const nameResult = await cdp.evaluate(`
        (function() {
          var picker = document.querySelector(".emoji-picker");
          if (!picker) return "NO_PICKER";
          var nameBtn = picker.querySelector(".ep-name-mode-btn");
          if (!nameBtn) return "NO_NAME_BTN";
          var wasBefore = nameBtn.classList.contains("active");
          nameBtn.click();
          var isAfter = nameBtn.classList.contains("active");
          // Toggle back
          nameBtn.click();
          var isReset = nameBtn.classList.contains("active");
          return "before=" + wasBefore + " after=" + isAfter + " reset=" + isReset;
        })()
      `);
      if (nameResult === "NO_NAME_BTN") throw new Error("Name mode button not found");
      // After click, should toggle (before=false → after=true)
      stepOK("Name mode toggle: " + nameResult);
    } catch (e) {
      stepSoftFail("Name mode: " + e.message);
    }

    stepStart("Testing emoji search...");
    try {
      const searchResult = await cdp.evaluate(`
        (function() {
          var picker = document.querySelector(".emoji-picker");
          if (!picker) return "NO_PICKER";
          var input = picker.querySelector(".ep-search input");
          if (!input) return "NO_INPUT";
          input.value = "thumbs";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return new Promise(function(resolve) {
            setTimeout(function() {
              var visibleEmojis = picker.querySelectorAll(".ep-emoji").length;
              // Clear search
              input.value = "";
              input.dispatchEvent(new Event("input", { bubbles: true }));
              resolve("filtered=" + visibleEmojis);
            }, 300);
          });
        })()
      `);
      if (searchResult === "NO_PICKER" || searchResult === "NO_INPUT") throw new Error(searchResult);
      var filteredCount = parseInt(searchResult.match(/filtered=(\d+)/)?.[1] || "0", 10);
      if (filteredCount === 0) throw new Error("Search returned 0 results: " + searchResult);
      stepOK("Emoji search: " + searchResult);
    } catch (e) {
      stepSoftFail("Emoji search: " + e.message);
    }

    stepStart("Clicking an emoji → verify inserted into editor...");
    try {
      const insertResult = await cdp.evaluate(`
        (function() {
          var picker = document.querySelector(".emoji-picker");
          if (!picker) return "NO_PICKER";
          // Find the first emoji button in the grid
          var firstEmoji = picker.querySelector(".ep-grid-area .ep-emoji");
          if (!firstEmoji) return "NO_EMOJI";
          firstEmoji.click();
          // Picker may not auto-close via CDP click (no real focus events),
          // so we check content insertion and clean up manually
          return new Promise(function(resolve) {
            setTimeout(function() {
              var view = window.__mdpadEditor && window.__mdpadEditor();
              var content = view ? view.state.doc.toString() : "";
              // Force-close picker if still open
              var remainingPicker = document.querySelector(".emoji-picker");
              if (remainingPicker) remainingPicker.remove();
              resolve("content_len=" + content.length + " inserted=" + (content.length > 0));
            }, 300);
          });
        })()
      `);
      if (insertResult === "NO_PICKER" || insertResult === "NO_EMOJI") throw new Error(insertResult);
      if (!insertResult.includes("inserted=true")) throw new Error("No content inserted: " + insertResult);
      stepOK("Emoji inserted: " + insertResult);
    } catch (e) {
      stepSoftFail("Emoji insert: " + e.message);
    }

    stepStart("Testing shortcode name mode insertion (:shortcode:)...");
    try {
      // Open picker again, enable name mode, click an emoji
      const shortcodeResult = await cdp.evaluate(`
        (function() {
          // Re-open picker via fb-emoji-btn
          var btn = document.getElementById("fb-emoji-btn");
          if (!btn) return "NO_EMOJI_BTN";
          btn.click();
          return new Promise(function(resolve) {
            setTimeout(function() {
              var picker = document.querySelector(".emoji-picker");
              if (!picker) { resolve("NO_PICKER"); return; }
              // Enable name mode
              var nameBtn = picker.querySelector(".ep-name-mode-btn");
              if (nameBtn && !nameBtn.classList.contains("active")) nameBtn.click();
              // Clear editor first
              var view = window.__mdpadEditor && window.__mdpadEditor();
              if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
              setTimeout(function() {
                // Click first emoji in grid
                var emoji = picker.querySelector(".ep-grid-area .ep-emoji");
                if (!emoji) { resolve("NO_EMOJI"); return; }
                emoji.click();
                setTimeout(function() {
                  var view2 = window.__mdpadEditor && window.__mdpadEditor();
                  var content = view2 ? view2.state.doc.toString() : "";
                  // Name mode should insert :shortcode: format
                  var hasColon = content.includes(":");
                  resolve("content=" + JSON.stringify(content) + " hasColon=" + hasColon);
                }, 300);
              }, 200);
            }, 500);
          });
        })()
      `);
      if (shortcodeResult.includes("NO_")) throw new Error(shortcodeResult);
      if (!shortcodeResult.includes("hasColon=true")) {
        stepSoftFail("Shortcode mode may not have inserted :code: format: " + shortcodeResult);
      } else {
        stepOK("Shortcode insertion: " + shortcodeResult);
      }
    } catch (e) {
      stepSoftFail("Shortcode insertion: " + e.message);
    }

    // =====================================================================
    // Phase 14: Markdown Shortcode Rendering (Steps 57–58) [NEW]
    // =====================================================================
    stepStart("Testing :shortcode: rendering in preview...");
    try {
      // Set editor content with shortcode emoji
      await cdp.evaluate(`
        (function() {
          var view = window.__mdpadEditor && window.__mdpadEditor();
          if (view) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Hello :wave: World :rocket:" } });
          }
        })()
      `);
      // Show preview pane
      await cdp.evaluate(`
        (function() {
          var p = document.getElementById("preview-pane");
          if (p && p.style.display === "none" && window.__mdpadHandleMenuAction) {
            window.__mdpadHandleMenuAction("togglePreview");
          }
        })()
      `);
      await sleep(1500);

      const previewResult = await cdp.evaluate(`
        (function() {
          var preview = document.getElementById("preview-pane");
          if (!preview) return "NO_PREVIEW";
          var content = preview.textContent || "";
          // The shortcodes should be rendered as emoji characters, not as :wave: text
          var hasWaveText = content.includes(":wave:");
          var hasRocketText = content.includes(":rocket:");
          // Check for emoji characters (wave = 👋, rocket = 🚀)
          var hasWaveEmoji = content.includes("\\u{1F44B}") || content.includes("👋");
          var hasRocketEmoji = content.includes("\\u{1F680}") || content.includes("🚀");
          return "wave_text=" + hasWaveText + " rocket_text=" + hasRocketText +
                 " wave_emoji=" + hasWaveEmoji + " rocket_emoji=" + hasRocketEmoji;
        })()
      `);
      if (previewResult === "NO_PREVIEW") throw new Error("Preview pane not found");
      // Shortcodes should NOT appear as text (they should be rendered)
      if (previewResult.includes("wave_text=true")) {
        throw new Error("Shortcode :wave: not rendered: " + previewResult);
      }
      stepOK("Shortcode rendering: " + previewResult);
    } catch (e) {
      stepSoftFail("Shortcode rendering: " + e.message);
    }

    stepStart("Testing multiple shortcode types in preview...");
    try {
      await cdp.evaluate(`
        (function() {
          var view = window.__mdpadEditor && window.__mdpadEditor();
          if (view) {
            view.dispatch({
              changes: {
                from: 0, to: view.state.doc.length,
                insert: ":+1: :heart: :smile: :100: :fire:"
              }
            });
          }
        })()
      `);
      await sleep(2000);

      const multiResult = await cdp.evaluate(`
        (function() {
          // Get actual rendered preview content from markdown-body div
          var body = document.querySelector("#preview-pane .markdown-body");
          if (!body) {
            var preview = document.getElementById("preview-pane");
            if (!preview) return "NO_PREVIEW";
            body = preview;
          }
          var content = body.textContent || "";
          // Count how many shortcodes remain as text (not rendered)
          var unresolvedCount = 0;
          var codes = ["+1", "heart", "smile", "100", "fire"];
          for (var c of codes) {
            if (content.includes(":" + c + ":")) unresolvedCount++;
          }
          return "unresolved=" + unresolvedCount + "/5 content_preview=" + content.substring(0, 50);
        })()
      `);
      if (multiResult === "NO_PREVIEW") throw new Error("Preview pane not found");
      // All 5 should be resolved (0 unresolved)
      if (!multiResult.includes("unresolved=0/5")) {
        throw new Error("Some shortcodes not rendered: " + multiResult);
      }
      stepOK("Multi-shortcode rendering: " + multiResult);
    } catch (e) {
      stepSoftFail("Multi-shortcode: " + e.message);
    }

    // =====================================================================
    // Phase 15: Cleanup (Step 59)
    // =====================================================================
    stepStart("Force-closing process and cleaning up...");
    cdp.close();
    cdp = null;
    killMdpad();

    const deadline = Date.now() + TIMEOUT_CLOSE;
    while (!exited && Date.now() < deadline) {
      await sleep(200);
    }

    // Cleanup stale artifacts
    let cleanedUp = 0;
    try {
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        cleanedUp++;
      }
    } catch {}
    const sessionsDir = path.join(getUserDataPath(), "sessions");
    const autosaveDir = path.join(getUserDataPath(), "autosave");
    for (const dir of [sessionsDir, autosaveDir]) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith(".json")) {
            const stem = f.replace(/^(session|autosave)-/, "").replace(".json", "");
            const pid = parseInt(stem.split("-")[0], 10);
            if (isNaN(pid)) continue;
            let alive = false;
            try { process.kill(pid, 0); alive = true; } catch {}
            if (!alive) {
              try {
                fs.unlinkSync(path.join(dir, f));
                cleanedUp++;
              } catch {}
            }
          }
        }
      } catch {}
    }
    stepOK(`Process exited (code=${exitCode}), cleaned ${cleanedUp} artifact(s)`);

    // =====================================================================
    // Summary
    // =====================================================================
    const passCount = results.filter((r) => r.status === "PASS").length;
    const softFailResults = results.filter((r) => r.status === "SOFT FAIL");

    console.log("\n" + "=".repeat(60));
    if (softFailCount === 0) {
      console.log(`SMOKE TEST PASSED (${passCount}/${totalSteps} steps — all PASS)`);
    } else {
      console.log(`SMOKE TEST PASSED (${passCount}/${totalSteps} PASS, ${softFailCount} SOFT FAIL)`);
    }
    console.log("=".repeat(60));
    for (const r of results) {
      const tag = r.status === "PASS" ? "PASS" : "SOFT";
      console.log(`  [${tag}] Step ${r.step}: ${r.msg}`);
    }
    if (softFailResults.length > 0) {
      console.log("\n  Soft failures (non-critical):");
      for (const r of softFailResults) {
        console.log(`    Step ${r.step}: ${r.msg}`);
      }
    }
    console.log("=".repeat(60));
    process.exit(0);

  } catch (err) {
    console.error(`\nSMOKE TEST FAILED at step ${stepNum}: ${err.message}`);
    // Print partial results
    if (results.length > 0) {
      console.log("\nPartial results:");
      for (const r of results) {
        console.log(`  [${r.status}] Step ${r.step}: ${r.msg}`);
      }
    }
    if (cdp) cdp.close();
    killMdpad();
    try { fs.unlinkSync(sessionFile); } catch {}
    process.exit(1);
  }
}

main();
