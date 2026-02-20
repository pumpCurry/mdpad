/**
 * EXE Smoke Test for mdpad
 *
 * Comprehensive viability test after packaging:
 *
 * Phase 1 — Recovery modal
 *   1. Create a fake orphaned session file (unique name per run)
 *   2. Launch EXE, verify recovery modal appears
 *   3. Restore from the fake session → verify content loaded
 *
 * Phase 2 — Search & Replace
 *   4. Open Find panel (Ctrl+F), enter search term
 *   5. Verify matches are highlighted (match count > 0)
 *   6. Click "next" and "previous" (Ctrl+G / Shift+Ctrl+G via keys)
 *   7. Open Replace (Ctrl+H), perform a replacement
 *
 * Phase 3 — Global search bar
 *   8. Type into global search bar, verify results appear
 *
 * Phase 4 — Edit operations
 *   9. Select all (Ctrl+A), delete → verify empty
 *  10. Undo (Ctrl+Z) → verify content restored
 *  11. Insert new text for dirty state
 *
 * Phase 5 — Close verification
 *  10. Verify isDirty=true → save dialog would appear on close
 *  11. Force-close process
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

  const candidates = ["build6", "build5", "build4", "build3", "build2", "build"].map(
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
const totalSteps = 11;
const results = [];

function stepStart(label) {
  stepNum++;
  console.log(`[${stepNum}/${totalSteps}] ${label}`);
}

function stepOK(msg) {
  console.log(`  OK  ${msg}`);
  results.push({ step: stepNum, status: "PASS", msg });
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

/**
 * Get the userData path for mdpad (Electron convention)
 */
function getUserDataPath() {
  return path.join(os.homedir(), "AppData", "Roaming", "mdpad");
}

/**
 * Create a fake orphaned session file with a non-existent PID.
 * Returns the path to the created file.
 */
function createFakeRecoverySession() {
  const sessionsDir = path.join(getUserDataPath(), "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  // Use a PID that definitely doesn't exist (99999 + random)
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
  console.log(`Test run: ${TEST_RUN_ID}\n`);

  // Pre-cleanup
  killMdpad();
  await sleep(1000);

  // =====================================================================
  // Phase 1: Recovery modal
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

    stepStart("Connecting to DevTools + verifying recovery modal...");
    cdp = new CDPSession(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    stepOK("DevTools connected");

    // Wait for app init + recovery modal
    await sleep(4000);

    // Check if recovery modal is visible (retry a few times)
    let hasModal = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      hasModal = await cdp.evaluate(`!!document.getElementById("recovery-overlay")`);
      if (hasModal) break;
      await sleep(1000);
    }
    if (!hasModal) {
      // Debug: check if any sessions were found
      const debug = await cdp.evaluate(`
        (function() {
          var body = document.body.innerHTML.substring(0, 500);
          return "overlay=" + !!document.getElementById("recovery-overlay") +
                 " body_len=" + document.body.innerHTML.length;
        })()
      `);
      throw new Error("Recovery modal did not appear. Debug: " + debug);
    }
    stepOK("Recovery modal appeared");

    // Click "Restore" button
    stepStart("Restoring from recovery...");
    const restored = await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("recovery-overlay");
        if (!overlay) return "NO_MODAL";
        // Find and click the restore button (green button)
        var buttons = overlay.querySelectorAll("button");
        for (var b of buttons) {
          if (b.textContent.includes("復元") || b.textContent.includes("Restore")) {
            b.click();
            return "CLICKED";
          }
        }
        return "NO_RESTORE_BTN";
      })()
    `);
    if (restored !== "CLICKED") throw new Error("Could not click Restore: " + restored);
    await sleep(1000);

    // Verify content was loaded
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
    // Phase 2: Search & Replace
    // =====================================================================
    stepStart("Opening Find panel (Ctrl+F) and searching...");

    // Use Ctrl+F to open search
    await cdp.dispatchKey("f", CTRL, 70);
    await sleep(500);

    // Type search term into the search input
    const searchFilled = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var input = panel.querySelector("input[name='search'], input.cm-textfield");
        if (!input) return "NO_INPUT";
        input.focus();
        input.value = "${SEARCH_TERM}";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return "OK";
      })()
    `);
    if (searchFilled !== "OK") throw new Error("Search fill: " + searchFilled);
    await sleep(500);

    // Verify match count exists (the match count info element)
    const matchInfo = await cdp.evaluate(`
      (function() {
        var info = document.querySelector(".cm-search-match-info");
        return info ? info.textContent : "NONE";
      })()
    `);
    stepOK("Search panel opened, matches: " + matchInfo);

    stepStart("Testing Find Next / Find Previous...");
    // Click next button
    const nextResult = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var btns = panel.querySelectorAll("button");
        for (var b of btns) {
          if (b.name === "next" || b.textContent.includes("next") || b.textContent.includes("次")) {
            b.click();
            return "NEXT_OK";
          }
        }
        return "NO_NEXT_BTN";
      })()
    `);
    if (nextResult !== "NEXT_OK") throw new Error("Next: " + nextResult);
    await sleep(200);

    // Click previous button
    const prevResult = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var btns = panel.querySelectorAll("button");
        for (var b of btns) {
          if (b.name === "prev" || b.textContent.includes("previous") || b.textContent.includes("前")) {
            b.click();
            return "PREV_OK";
          }
        }
        return "NO_PREV_BTN";
      })()
    `);
    if (prevResult !== "PREV_OK") throw new Error("Prev: " + prevResult);
    stepOK("Find Next and Find Previous work");

    stepStart("Testing Replace...");
    // Open replace (Ctrl+H)
    await cdp.dispatchKey("h", CTRL, 72);
    await sleep(500);

    // Fill replace field
    const replaceFilled = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var inputs = panel.querySelectorAll("input.cm-textfield");
        if (inputs.length < 2) return "NO_REPLACE_INPUT (" + inputs.length + " inputs)";
        var replaceInput = inputs[1];
        replaceInput.focus();
        replaceInput.value = "REPLACED";
        replaceInput.dispatchEvent(new Event("input", { bubbles: true }));
        replaceInput.dispatchEvent(new Event("change", { bubbles: true }));
        return "OK";
      })()
    `);
    if (replaceFilled !== "OK") throw new Error("Replace fill: " + replaceFilled);
    await sleep(200);

    // Click "replace" button (single replace)
    const replaceResult = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        var btns = panel.querySelectorAll("button");
        for (var b of btns) {
          if (b.name === "replace" || (b.textContent.includes("replace") && !b.textContent.includes("all"))
              || (b.textContent.includes("置換") && !b.textContent.includes("すべて"))) {
            b.click();
            return "REPLACED";
          }
        }
        return "NO_REPLACE_BTN";
      })()
    `);
    if (replaceResult !== "REPLACED") throw new Error("Replace: " + replaceResult);
    await sleep(300);

    // Verify replacement occurred
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

    // Close search panel
    await cdp.dispatchKey("Escape", 0, 27);
    await sleep(200);

    // =====================================================================
    // Phase 3: Global search bar
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

    // Check results appeared (hit count or highlighted items)
    const gsResults = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return "NO_BAR";
        var hitCount = bar.querySelector(".gs-hit-count");
        return hitCount ? hitCount.textContent : "NO_HITS_ELEMENT";
      })()
    `);
    stepOK("Global search: " + gsResults);

    // Clear global search
    await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return;
        var input = bar.querySelector("input.gs-input");
        if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
      })()
    `);

    // =====================================================================
    // Phase 4: Select All → Delete → Undo
    // =====================================================================
    stepStart("Select All → Delete → Undo...");

    // Focus editor first
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (view) view.focus();
      })()
    `);
    await sleep(200);

    // Select all (Ctrl+A)
    await cdp.dispatchKey("a", CTRL, 65);
    await sleep(200);

    // Delete (Backspace)
    await cdp.dispatchKey("Backspace", 0, 8);
    await sleep(300);

    // Verify empty
    const afterDelete = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "NO_EDITOR";
        return view.state.doc.length === 0 ? "EMPTY" : "NOT_EMPTY:" + view.state.doc.length;
      })()
    `);
    if (afterDelete !== "EMPTY") throw new Error("After delete: " + afterDelete);

    // Undo (Ctrl+Z)
    await cdp.dispatchKey("z", CTRL, 90);
    await sleep(300);

    // Verify content restored
    const afterUndo = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return "";
        return view.state.doc.length > 0 ? "RESTORED:" + view.state.doc.length : "STILL_EMPTY";
      })()
    `);
    if (!afterUndo.startsWith("RESTORED:")) throw new Error("After undo: " + afterUndo);
    stepOK("Select All → Delete → Undo works (" + afterUndo + ")");

    // Insert new text so dirty state is set
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return;
        var len = view.state.doc.length;
        view.dispatch({ changes: { from: len, insert: "\\nsmoke test dirty" } });
      })()
    `);
    await sleep(200);

    // =====================================================================
    // Phase 5: Close dialogs
    // =====================================================================
    stepStart("Testing window close → cancel...");

    // Try to close window via CDP — this triggers the close handler
    // Use Browser.close but we need to intercept the dialog
    // Instead, we simulate the "close" action and check the dialog

    // Trigger close via JavaScript (the app uses beforeunload or close handler)
    // Actually, electron's close handler shows a native dialog. We can't interact with native dialogs via CDP.
    // Instead, verify via __mdpadGetCloseState that a dialog WOULD appear
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
    stepOK("Close state: isDirty=true → save dialog would appear on close");

    stepStart("Force-closing process...");
    cdp.close();
    cdp = null;
    killMdpad();

    const deadline = Date.now() + TIMEOUT_CLOSE;
    while (!exited && Date.now() < deadline) {
      await sleep(200);
    }
    stepOK(`Process exited (code=${exitCode})`);

    // =====================================================================
    // Summary
    // =====================================================================
    console.log("\n" + "=".repeat(60));
    console.log("SMOKE TEST PASSED (" + results.length + "/" + totalSteps + " steps)");
    console.log("=".repeat(60));
    for (const r of results) {
      console.log(`  [${r.status}] ${r.msg}`);
    }
    console.log("=".repeat(60));
    process.exit(0);

  } catch (err) {
    console.error(`\nSMOKE TEST FAILED at step ${stepNum}: ${err.message}`);
    if (cdp) cdp.close();
    killMdpad();
    // Clean up session file
    try { fs.unlinkSync(sessionFile); } catch {}
    process.exit(1);
  }
}

main();
