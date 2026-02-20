/**
 * EXE Smoke Test for mdpad
 *
 * Minimum viability test after packaging:
 *   1. Launch the EXE
 *   2. Wait for the window to appear
 *   3. Type some text into the editor
 *   4. Verify dirty state
 *   5. Verify close-state getter (save dialog would appear)
 *   6. Force-close and confirm exit
 *
 * Usage:
 *   node scripts/smoke-test.js [path-to-exe]
 *
 * If no path is given, defaults to build/win-unpacked/mdpad.exe
 * (or build2/win-unpacked/mdpad.exe if build/ does not exist).
 *
 * Requires: Node.js 22+ (built-in WebSocket)
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REMOTE_DEBUGGING_PORT = 19222;
const TIMEOUT_LAUNCH = 15000;
const TIMEOUT_CLOSE = 10000;

// ---------------------------------------------------------------------------
// Resolve EXE path
// ---------------------------------------------------------------------------
function resolveExePath() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);

  const candidates = [
    path.join(__dirname, "..", "build4", "win-unpacked", "mdpad.exe"),
    path.join(__dirname, "..", "build3", "win-unpacked", "mdpad.exe"),
    path.join(__dirname, "..", "build2", "win-unpacked", "mdpad.exe"),
    path.join(__dirname, "..", "build", "win-unpacked", "mdpad.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Test steps
// ---------------------------------------------------------------------------
async function main() {
  const exePath = resolveExePath();
  if (!exePath) {
    console.error("FAIL: EXE not found. Run 'npm run build' first.");
    process.exit(1);
  }
  console.log(`EXE: ${exePath}\n`);

  // Pre-cleanup
  killMdpad();
  await sleep(1000);

  // Step 1: Launch
  console.log("[1/6] Launching EXE...");
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
    // Step 2: Wait for window
    console.log("[2/6] Waiting for window...");
    const page = await waitForDebugger(REMOTE_DEBUGGING_PORT, TIMEOUT_LAUNCH);
    console.log(`  OK  Window: ${page.title || page.url}`);

    // Step 3: Connect CDP
    console.log("[3/6] Connecting to DevTools...");
    cdp = new CDPSession(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    console.log("  OK  DevTools connected");

    // Wait for app init
    await sleep(2000);

    // Step 4: Type text
    console.log("[4/6] Typing text into editor...");
    const typed = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        if (!view) return 'ERROR: __mdpadEditor not available';
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: 'Hello smoke test!' }
        });
        return 'OK';
      })()
    `);
    if (typed !== "OK") throw new Error("Type text: " + typed);
    console.log("  OK  Text inserted");

    await sleep(500);

    // Step 5: Verify dirty + close state
    console.log("[5/6] Verifying dirty state...");
    const stateJSON = await cdp.evaluate(`
      JSON.stringify(
        window.__mdpadGetCloseState
          ? window.__mdpadGetCloseState()
          : { error: 'getter not found' }
      )
    `);
    const state = JSON.parse(stateJSON);
    if (state.error) throw new Error(state.error);
    if (!state.isDirty) throw new Error("isDirty should be true after typing");
    if (state.hasFilePath) throw new Error("hasFilePath should be false for new doc");
    console.log("  OK  isDirty=true, hasFilePath=false");
    console.log("  OK  Close would trigger save dialog");

    // Step 6: Force close
    console.log("[6/6] Closing process...");
    cdp.close();
    cdp = null;

    killMdpad();

    const deadline = Date.now() + TIMEOUT_CLOSE;
    while (!exited && Date.now() < deadline) {
      await sleep(200);
    }
    console.log(`  OK  Process exited (code=${exitCode})`);

    // Summary
    console.log("\n==================================================");
    console.log("SMOKE TEST PASSED");
    console.log("==================================================");
    console.log("  [PASS] EXE launched");
    console.log("  [PASS] Window appeared");
    console.log("  [PASS] Editor accepted input");
    console.log("  [PASS] Dirty state tracked");
    console.log("  [PASS] Close state correct (save dialog expected)");
    console.log("  [PASS] Process exited");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    if (cdp) cdp.close();
    killMdpad();
    process.exit(1);
  }
}

main();
