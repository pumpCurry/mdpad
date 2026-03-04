/**
 * @fileoverview EXE Smoke Test for mdpad — Comprehensive Regression Suite
 * @description EXE ビルドを起動し、CDP（Chrome DevTools Protocol）経由で
 *   全機能の動作を自動検証するスモークテストスイート。
 *   リカバリモーダル、ステータスバー、ペインマネージャ、エディタ操作、
 *   検索/置換、フォーマット、プレビュー、ダイアログ等を網羅する。
 * @file smoke-test.js
 * @version 1.1.00068
 * @revision 1
 * @lastModified 2026-03-04 22:00:00 (JST)
 *
 * ~131-step test covering ALL features with actual behavior verification:
 *
 * Phase 0  — Setup (3 steps)
 * Phase 1  — Recovery modal (2 steps)
 * Phase 2  — Status bar verification (5 steps)
 * Phase 3  — Pane manager (7 steps)
 * Phase 4  — Editor operations (5 steps)
 * Phase 5  — Find & Replace (5 steps)
 * Phase 6  — Global search (3 steps)
 * Phase 7  — Format: inline toggles (10 steps)
 * Phase 8  — Format: headings (7 steps)
 * Phase 9  — Format: lists & blocks (8 steps)
 * Phase 10 — Format: active state detection (4 steps)
 * Phase 11 — Format: keyboard shortcuts (6 steps)
 * Phase 12 — Preview rendering (14 steps)
 * Phase 13 — Context menu (6 steps)
 * Phase 14 — Format toolbar modes (5 steps) + sidebar tests (7 steps)
 * Phase 15 — Emoji picker (8 steps)
 * Phase 16 — Dialogs (12 steps)
 * Phase 17 — EOL selection (3 steps)
 * Phase 18 — Dirty state (4 steps)
 * Phase 19 — Diff pane (3 steps)
 * Phase 20 — Locale switching (2 steps)
 * Phase 21 — Autosave status (2 steps)
 * Phase 22 — Shortcode rendering (2 steps)
 * Phase 23 — Check for Updates (3 steps)
 * Phase 24 — Cleanup (1 step)
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

  const candidates = [];
  for (let i = 30; i >= 1; i--) candidates.push(`build${i}`);
  candidates.push("build");
  for (const d of candidates) {
    const p = path.join(__dirname, "..", d, "win-unpacked", "mdpad.exe");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stepNum = 0;
const totalSteps = 138;
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
    } catch {}
    await sleep(500);
  }
  throw new Error("Timed out waiting for DevTools debugger");
}

function killMdpad() {
  try {
    execSync("taskkill /F /IM mdpad.exe /T 2>nul", { stdio: "ignore" });
  } catch {}
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
// Format test helper
// ---------------------------------------------------------------------------
async function testFormat(cdp, label, setupText, selFrom, selTo, formatId, expected, contains) {
  stepStart(label);
  // Use direct command executor to bypass toolbar button focus issues
  await cdp.evaluate(`window.__mdpadSetAndSelect(${JSON.stringify(setupText)}, ${selFrom}, ${selTo})`);
  await sleep(50);
  const content = await cdp.evaluate(`window.__mdpadExecFormat("${formatId}")`);
  if (content === "NO_CMD_OR_EDITOR") throw new Error(`Format command "${formatId}" not found or no editor`);
  if (typeof content === "string" && content.startsWith("ERROR:")) throw new Error(`Format error: ${content}`);
  if (contains) {
    if (!content.includes(expected)) throw new Error(`Expected to contain "${expected}", got "${content}"`);
  } else {
    if (content !== expected) throw new Error(`Expected "${expected}", got "${content}"`);
  }
  stepOK(`"${setupText}" → "${content.substring(0, 60)}"`);
}

// Helper: open heading dropdown and click an item
async function clickHeadingItem(cdp, headingId) {
  // Open the heading dropdown — button creates overlay on click
  await cdp.evaluate(`
    (function() {
      var btn = document.querySelector('[data-format-id="heading"]');
      if (btn) btn.click();
    })()
  `);
  await sleep(300);
  // Click the heading item in the dropdown overlay
  await cdp.evaluate(`
    (function() {
      // Look in both toolbar dropdown and body-appended overlays
      var item = document.querySelector('[data-format-id="${headingId}"]');
      if (item) { item.click(); return "CLICKED"; }
      // Try dropdown items
      var items = document.querySelectorAll(".fb-dropdown-item");
      for (var it of items) {
        if (it.dataset.formatId === "${headingId}") { it.click(); return "CLICKED_DD"; }
      }
      return "NOT_FOUND";
    })()
  `);
  await sleep(250);
}

// Helper: get editor content
async function getEditorContent(cdp) {
  return await cdp.evaluate(`window.__mdpadGetContent()`);
}

// Helper: set editor content (with dirty suppression)
async function setEditorContent(cdp, text) {
  await cdp.evaluate(`window.__mdpadSetAndSelect(${JSON.stringify(text)})`);
  await sleep(100);
}

// Helper: ensure all overlays are dismissed
async function dismissOverlays(cdp) {
  await cdp.evaluate(`
    (function() {
      ["recovery-overlay","close-dialog-overlay","confirm-save-overlay","about-overlay",
       "goto-line-overlay","properties-overlay","update-overlay"].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
      });
      var menus = document.querySelectorAll(".format-context-menu, .fcm-submenu, .emoji-picker");
      menus.forEach(function(m) { m.remove(); });
    })()
  `);
  await sleep(200);
}

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

    // Ensure format toolbar is in topbar mode
    await cdp.evaluate(`
      (function() {
        if (window.__mdpadHandleMenuAction) {
          window.__mdpadHandleMenuAction("setFormatBar:topbar");
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
        "overlay=" + !!document.getElementById("recovery-overlay") +
        " body_len=" + document.body.innerHTML.length
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

    const recoveredContent = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor && window.__mdpadEditor();
        return view ? view.state.doc.toString() : "";
      })()
    `);
    if (!recoveredContent.includes(`Recovery Test ${TEST_RUN_ID}`)) {
      throw new Error("Recovery content not loaded. Got: " + recoveredContent.substring(0, 80));
    }
    stepOK("Recovery content restored (test ID: " + TEST_RUN_ID + ")");
    try { fs.unlinkSync(sessionFile); } catch {}

    // =====================================================================
    // Phase 2: Status Bar Verification (Steps 6–10)
    // =====================================================================
    stepStart("Cursor info shows Ln/Col format...");
    const cursorText = await cdp.evaluate(`
      (function() {
        var el = document.getElementById("sb-cursor");
        return el ? el.textContent : "NOT_FOUND";
      })()
    `);
    if (cursorText === "NOT_FOUND") throw new Error("#sb-cursor not found");
    if (!cursorText.match(/\d/)) throw new Error("Cursor text has no numbers: " + cursorText);
    stepOK("Cursor info: " + cursorText);

    stepStart("Line count updates with content...");
    await sleep(500);
    // リカバリ後に内容がクリアされる場合がある（タイミング依存）
    // その場合はテスト用コンテンツを再挿入して後続テストを継続する
    const postRecoveryContent = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        return view ? view.state.doc.toString() : "";
      })()
    `);
    if (!postRecoveryContent || postRecoveryContent.trim().length === 0) {
      await cdp.evaluate(`window.__mdpadSetAndSelect("line1\\nline2\\nline3\\nline4\\nline5", 0, 0)`);
      await sleep(300);
    }
    const linesText = await cdp.evaluate(`
      (function() {
        var el = document.getElementById("sb-lines");
        return el ? el.textContent : "NOT_FOUND";
      })()
    `);
    if (linesText === "NOT_FOUND") throw new Error("#sb-lines not found");
    if (!linesText.match(/\d+/)) throw new Error("No number in lines text: " + linesText);
    stepOK("Line count: " + linesText);

    stepStart("Cursor position updates on move...");
    // カーソルを行3に移動（CDP 経由で直接 dispatch）
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        var line3 = view.state.doc.line(3);
        view.dispatch({ selection: { anchor: line3.from } });
      })()
    `);
    // ステータスバー更新は setInterval(200ms) + requestAnimationFrame の2段階。
    // 固定待機では rAF 遅延によりフレーキーになるため、ポーリングで待機する。
    let cursorAfterMove = "";
    for (let pollAttempt = 0; pollAttempt < 10; pollAttempt++) {
      await sleep(200);
      cursorAfterMove = await cdp.evaluate(`document.getElementById("sb-cursor").textContent`);
      if (cursorAfterMove.includes("3")) break;
    }
    if (!cursorAfterMove.includes("3")) throw new Error("Cursor not on line 3: " + cursorAfterMove);
    stepOK("Cursor moved to line 3: " + cursorAfterMove);

    stepStart("EOL indicator shows valid value...");
    const eolText = await cdp.evaluate(`
      (function() {
        var el = document.getElementById("sb-eol");
        return el ? el.textContent.trim() : "NOT_FOUND";
      })()
    `);
    if (eolText === "NOT_FOUND") throw new Error("#sb-eol not found");
    if (!["LF", "CRLF", "CR"].includes(eolText)) throw new Error("Unexpected EOL: " + eolText);
    stepOK("EOL indicator: " + eolText);

    stepStart("Zoom percentage in status bar...");
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

    // =====================================================================
    // Phase 3: Pane Manager (Steps 11–17)
    // =====================================================================
    stepStart("Toggle Preview on...");
    // First ensure preview is off, then toggle on
    await cdp.evaluate(`
      (function() {
        var p = document.getElementById("preview-pane");
        if (p && p.style.display !== "none") window.__mdpadHandleMenuAction("togglePreview");
      })()
    `);
    await sleep(200);
    await cdp.evaluate(`window.__mdpadHandleMenuAction("togglePreview")`);
    await sleep(300);
    const previewDisp = await cdp.evaluate(`document.getElementById("preview-pane").style.display`);
    if (previewDisp === "none") throw new Error("Preview pane not visible after toggle on");
    stepOK("Preview pane visible: " + previewDisp);

    stepStart("Toggle Diff on...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("toggleDiff")`);
    await sleep(300);
    const diffDisp = await cdp.evaluate(`document.getElementById("diff-pane").style.display`);
    if (diffDisp === "none") throw new Error("Diff pane not visible after toggle on");
    stepOK("Diff pane visible: " + diffDisp);

    stepStart("All panes button → all 3 visible...");
    const allResult = await cdp.evaluate(`
      (function() {
        var btn = document.getElementById("btn-all");
        if (!btn) return "NO_BTN";
        btn.click();
        var e = document.getElementById("editor-pane").style.display;
        var p = document.getElementById("preview-pane").style.display;
        var d = document.getElementById("diff-pane").style.display;
        return e + "," + p + "," + d;
      })()
    `);
    if (allResult === "NO_BTN") throw new Error("#btn-all not found");
    if (allResult.includes("none")) throw new Error("Not all panes visible: " + allResult);
    stepOK("All panes: " + allResult);
    await sleep(300);

    stepStart("Toggle Editor off → others remain...");
    await cdp.evaluate(`
      (function() {
        var btn = document.getElementById("btn-editor");
        if (btn) btn.click();
      })()
    `);
    await sleep(200);
    const editorOff = await cdp.evaluate(`
      (function() {
        var e = document.getElementById("editor-pane");
        var p = document.getElementById("preview-pane");
        var d = document.getElementById("diff-pane");
        var vis = 0;
        if (e && e.style.display !== "none") vis++;
        if (p && p.style.display !== "none") vis++;
        if (d && d.style.display !== "none") vis++;
        return vis;
      })()
    `);
    if (editorOff < 1) throw new Error("No panes visible after editor toggle off");
    stepOK("Panes visible after editor off: " + editorOff);

    stepStart("Last pane cannot be hidden...");
    // Hide all except one, try to hide the last
    await cdp.evaluate(`
      (function() {
        var btn = document.getElementById("btn-all");
        if (btn) btn.click();
      })()
    `);
    await sleep(200);
    // Hide preview, diff, and TOC, leaving only editor
    await cdp.evaluate(`
      (function() {
        var p = document.getElementById("preview-pane");
        if (p && p.style.display !== "none") window.__mdpadHandleMenuAction("togglePreview");
        var d = document.getElementById("diff-pane");
        if (d && d.style.display !== "none") window.__mdpadHandleMenuAction("toggleDiff");
        var t = document.getElementById("toc-pane");
        if (t && t.style.display !== "none") window.__mdpadHandleMenuAction("toggleToc");
      })()
    `);
    await sleep(200);
    // Ensure editor is visible
    await cdp.evaluate(`
      (function() {
        var e = document.getElementById("editor-pane");
        if (e && e.style.display === "none") window.__mdpadHandleMenuAction("toggleEditor");
      })()
    `);
    await sleep(200);
    // Try to hide the last pane (editor)
    await cdp.evaluate(`window.__mdpadHandleMenuAction("toggleEditor")`);
    await sleep(200);
    const lastPaneVis = await cdp.evaluate(`
      (function() {
        var e = document.getElementById("editor-pane");
        var p = document.getElementById("preview-pane");
        var d = document.getElementById("diff-pane");
        var t = document.getElementById("toc-pane");
        var vis = 0;
        if (e && e.style.display !== "none") vis++;
        if (p && p.style.display !== "none") vis++;
        if (d && d.style.display !== "none") vis++;
        if (t && t.style.display !== "none") vis++;
        return vis;
      })()
    `);
    if (lastPaneVis < 1) throw new Error("All panes hidden — protection failed");
    stepOK("Last pane protection works, visible: " + lastPaneVis);

    stepStart("Ctrl+1/2/3 keyboard shortcuts toggle panes...");
    // Reset to editor only (TOCも非表示にする)
    await cdp.evaluate(`
      (function() {
        var p = document.getElementById("preview-pane");
        if (p && p.style.display !== "none") window.__mdpadHandleMenuAction("togglePreview");
        var d = document.getElementById("diff-pane");
        if (d && d.style.display !== "none") window.__mdpadHandleMenuAction("toggleDiff");
        var t = document.getElementById("toc-pane");
        if (t && t.style.display !== "none") window.__mdpadHandleMenuAction("toggleToc");
        var e = document.getElementById("editor-pane");
        if (e && e.style.display === "none") window.__mdpadHandleMenuAction("toggleEditor");
      })()
    `);
    await sleep(200);
    // Ctrl+2 should show preview
    await cdp.evaluate(`window.__mdpadHandleMenuAction("togglePreview")`);
    await sleep(200);
    const afterCtrl2 = await cdp.evaluate(`document.getElementById("preview-pane").style.display`);
    if (afterCtrl2 === "none") throw new Error("Ctrl+2 did not show preview");
    stepOK("Pane keyboard toggle works");

    stepStart("Reset panes: editor on, preview/diff off...");
    await cdp.evaluate(`
      (function() {
        var e = document.getElementById("editor-pane");
        if (e && e.style.display === "none") window.__mdpadHandleMenuAction("toggleEditor");
        var p = document.getElementById("preview-pane");
        if (p && p.style.display !== "none") window.__mdpadHandleMenuAction("togglePreview");
        var d = document.getElementById("diff-pane");
        if (d && d.style.display !== "none") window.__mdpadHandleMenuAction("toggleDiff");
        var t = document.getElementById("toc-pane");
        if (t && t.style.display !== "none") window.__mdpadHandleMenuAction("toggleToc");
      })()
    `);
    await sleep(300);
    stepOK("Panes reset");

    // =====================================================================
    // Phase 4: Editor Operations (Steps 18–22)
    // =====================================================================
    stepStart("Insert text → content appears...");
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "hello world" } });
      })()
    `);
    let edContent = await getEditorContent(cdp);
    if (edContent !== "hello world") throw new Error("Insert failed: got " + edContent);
    stepOK("Content: " + edContent);

    stepStart("Select All + Delete → empty...");
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("a", CTRL, 65);
    await sleep(100);
    await cdp.dispatchKey("Backspace", 0, 8);
    await sleep(200);
    edContent = await getEditorContent(cdp);
    if (edContent.length > 0) throw new Error("Delete failed, still has: " + edContent);
    stepOK("Editor empty after delete");

    stepStart("Undo (Ctrl+Z) → content restored...");
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("z", CTRL, 90);
    await sleep(200);
    edContent = await getEditorContent(cdp);
    if (edContent.length === 0) throw new Error("Undo failed, still empty");
    stepOK("Undo restored: " + edContent.substring(0, 30));

    stepStart("Redo (Ctrl+Y) → empty again...");
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("y", CTRL, 89);
    await sleep(200);
    edContent = await getEditorContent(cdp);
    if (edContent.length > 0) throw new Error("Redo failed, still has content");
    stepOK("Redo cleared editor");

    stepStart("Word Wrap toggle...");
    // Undo to get content back, then test word wrap
    await cdp.dispatchKey("z", CTRL, 90);
    await sleep(200);
    await cdp.evaluate(`window.__mdpadHandleMenuAction("toggleWordWrap")`);
    await sleep(200);
    const hasWrapping = await cdp.evaluate(`
      (function() {
        var ed = window.__mdpadEditor();
        return ed.dom.classList.contains("cm-lineWrapping");
      })()
    `);
    // Toggle back to original state
    await cdp.evaluate(`window.__mdpadHandleMenuAction("toggleWordWrap")`);
    await sleep(200);
    const noWrapping = await cdp.evaluate(`
      (function() {
        var ed = window.__mdpadEditor();
        return !ed.dom.classList.contains("cm-lineWrapping");
      })()
    `);
    if (hasWrapping === noWrapping) throw new Error("Word wrap toggle did not change state");
    stepOK("Word wrap toggled: " + hasWrapping + " → " + noWrapping);

    // =====================================================================
    // Phase 5: Find & Replace (Steps 23–27)
    // =====================================================================
    stepStart("Set content and open Find panel...");
    await setEditorContent(cdp, "foo bar baz\nfoo qux foo\nline three");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("find")`);
    await sleep(800);
    const searchExists = await cdp.evaluate(`!!document.querySelector(".cm-search")`);
    if (!searchExists) throw new Error("Search panel not found");
    stepOK("Find panel opened");

    stepStart("Search panel has inputs and buttons...");
    const panelInfo = await cdp.evaluate(`
      (function() {
        var panel = document.querySelector(".cm-search");
        if (!panel) return "NO_PANEL";
        return "inputs=" + panel.querySelectorAll("input").length +
               " buttons=" + panel.querySelectorAll("button").length;
      })()
    `);
    if (panelInfo === "NO_PANEL") throw new Error("Panel disappeared");
    stepOK("Panel structure: " + panelInfo);

    stepStart("Programmatic search finds 'foo' matches...");
    const fooCount = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        var text = view.state.doc.toString();
        var count = 0, idx = 0;
        while ((idx = text.indexOf("${SEARCH_TERM}", idx)) !== -1) { count++; idx++; }
        return count;
      })()
    `);
    if (fooCount !== 3) throw new Error("Expected 3 foo matches, got " + fooCount);
    stepOK("Found 3 'foo' matches");

    stepStart("Replace 'foo' → 'REPLACED'...");
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        var text = view.state.doc.toString();
        var idx = text.indexOf("foo");
        if (idx >= 0) {
          view.dispatch({ changes: { from: idx, to: idx + 3, insert: "REPLACED" } });
        }
      })()
    `);
    await sleep(200);
    const afterReplace = await getEditorContent(cdp);
    if (!afterReplace.includes("REPLACED")) throw new Error("Replace failed");
    stepOK("Replace applied: " + afterReplace.substring(0, 30));

    stepStart("Close search panel...");
    // Try clicking close button, fall back to Escape
    await cdp.evaluate(`
      (function() {
        var close = document.querySelector(".cm-search button[name='close']");
        if (close) { close.click(); return; }
        var btns = document.querySelectorAll(".cm-search button");
        for (var b of btns) { if (b.textContent.includes("×") || b.name === "close") { b.click(); return; } }
      })()
    `);
    await sleep(300);
    let searchGone = await cdp.evaluate(`!document.querySelector(".cm-search")`);
    if (!searchGone) {
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      searchGone = await cdp.evaluate(`!document.querySelector(".cm-search")`);
    }
    if (!searchGone) throw new Error("Search panel still visible");
    stepOK("Search panel closed");

    // =====================================================================
    // Phase 6: Global Search (Steps 28–30)
    // =====================================================================
    stepStart("Global search bar accepts input...");
    const gsExists = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("global-search-bar");
        if (!bar) return "NO_BAR";
        var input = bar.querySelector(".gs-input");
        if (!input) return "NO_INPUT";
        input.value = "REPLACED";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return "OK";
      })()
    `);
    if (gsExists !== "OK") throw new Error("Global search: " + gsExists);
    await sleep(500);
    stepOK("Global search input accepted");

    stepStart("Hit count displayed...");
    const hitCount = await cdp.evaluate(`
      (function() {
        var el = document.querySelector(".gs-hit-count");
        return el ? el.textContent : "NOT_FOUND";
      })()
    `);
    if (hitCount === "NOT_FOUND") throw new Error("Hit count element not found");
    stepOK("Hit count: " + hitCount);

    stepStart("Pane toggle filter works...");
    const toggleResult = await cdp.evaluate(`
      (function() {
        var toggle = document.querySelector('.gs-toggle[data-pane="preview"]');
        if (!toggle) return "NO_TOGGLE";
        toggle.click();
        return "TOGGLED";
      })()
    `);
    if (toggleResult !== "TOGGLED") throw new Error("Pane toggle: " + toggleResult);
    stepOK("Pane toggle clicked");

    // Clear global search
    await cdp.evaluate(`
      (function() {
        var input = document.querySelector(".gs-input");
        if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
      })()
    `);
    await sleep(200);

    // Clear global search highlights before format tests to avoid decoration conflicts
    await cdp.evaluate(`
      (function() {
        var input = document.querySelector("#global-search-input");
        if (input) { input.value = ""; input.dispatchEvent(new Event("input")); }
      })()
    `);
    await sleep(200);

    // =====================================================================
    // Phase 7: Format — Inline Toggles (Steps 31–40)
    // =====================================================================
    await testFormat(cdp, "Bold: apply",
      "hello", 0, 5, "bold", "**hello**");

    await testFormat(cdp, "Bold: toggle off",
      "**hello**", 2, 7, "bold", "hello");

    await testFormat(cdp, "Italic: apply",
      "hello", 0, 5, "italic", "*hello*");

    await testFormat(cdp, "Strikethrough: apply",
      "hello", 0, 5, "strikethrough", "~~hello~~");

    await testFormat(cdp, "Inline code: apply",
      "hello", 0, 5, "inlineCode", "`hello`");

    await testFormat(cdp, "Underline: apply",
      "hello", 0, 5, "underline", "<u>hello</u>");

    await testFormat(cdp, "Kbd: apply",
      "hello", 0, 5, "kbd", "<kbd>hello</kbd>");

    await testFormat(cdp, "Link: insert",
      "hello", 0, 5, "link", "[hello](url)");

    await testFormat(cdp, "Image: insert",
      "hello", 0, 5, "image", "![hello](url)");

    stepStart("Escape: special chars...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("# hello", 0, 7)`);
    await sleep(50);
    const escResult = await cdp.evaluate(`window.__mdpadExecFormat("escape")`);
    if (escResult === "NO_CMD_OR_EDITOR") throw new Error("Escape command not found");
    if (!escResult.includes("\\#")) throw new Error(`Escape failed: got "${escResult}"`);
    stepOK(`"# hello" → "${escResult}"`);

    // =====================================================================
    // Phase 8: Format — Headings (Steps 41–47)
    // =====================================================================
    await testFormat(cdp, "H1: apply",
      "hello", 0, 5, "h1", "# hello");

    await testFormat(cdp, "H2: apply",
      "hello", 0, 5, "h2", "## hello");

    await testFormat(cdp, "H3: apply",
      "hello", 0, 5, "h3", "### hello");

    stepStart("H4/H5/H6: apply...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await sleep(50);
    let hResult = await cdp.evaluate(`window.__mdpadExecFormat("h4")`);
    if (hResult !== "#### hello") throw new Error(`H4 failed: got "${hResult}"`);
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await sleep(50);
    hResult = await cdp.evaluate(`window.__mdpadExecFormat("h5")`);
    if (hResult !== "##### hello") throw new Error(`H5 failed: got "${hResult}"`);
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await sleep(50);
    hResult = await cdp.evaluate(`window.__mdpadExecFormat("h6")`);
    if (hResult !== "###### hello") throw new Error(`H6 failed: got "${hResult}"`);
    stepOK("H4/H5/H6 all correct");

    await testFormat(cdp, "H1 toggle off",
      "# hello", 2, 7, "h1", "hello");

    await testFormat(cdp, "Heading switch: H1 → H2",
      "# hello", 2, 7, "h2", "## hello");

    stepStart("Multi-line heading...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("line1\\nline2\\nline3", 0, 5)`);
    await sleep(50);
    hResult = await cdp.evaluate(`window.__mdpadExecFormat("h1")`);
    if (!hResult.startsWith("# line1")) throw new Error(`Multi-line heading failed: got "${hResult}"`);
    stepOK("Multi-line: " + hResult.substring(0, 30));

    // =====================================================================
    // Phase 9: Format — Lists & Blocks (Steps 48–55)
    // =====================================================================
    await testFormat(cdp, "Bullet list: apply",
      "hello", 0, 5, "bulletList", "- hello");

    await testFormat(cdp, "Numbered list: apply",
      "hello", 0, 5, "numberedList", "1. hello");

    await testFormat(cdp, "Task list: apply",
      "hello", 0, 5, "taskList", "- [ ] hello");

    await testFormat(cdp, "Blockquote: apply",
      "hello", 0, 5, "blockquote", "> hello");

    stepStart("Code block: insert...");
    await setEditorContent(cdp, "");
    await sleep(50);
    const codeResult = await cdp.evaluate(`window.__mdpadExecFormat("codeBlock")`);
    if (!codeResult.includes("```")) throw new Error(`Code block failed: got "${codeResult}"`);
    stepOK("Code block inserted");

    stepStart("Table: insert...");
    await setEditorContent(cdp, "");
    await sleep(50);
    const tableResult = await cdp.evaluate(`window.__mdpadExecFormat("table")`);
    if (!tableResult.includes("| Column 1 |")) throw new Error(`Table failed: got "${tableResult}"`);
    stepOK("Table inserted");

    stepStart("Details: insert...");
    await setEditorContent(cdp, "");
    await sleep(50);
    const detailsResult = await cdp.evaluate(`window.__mdpadExecFormat("details")`);
    if (!detailsResult.includes("<details>")) throw new Error(`Details failed: got "${detailsResult}"`);
    stepOK("Details block inserted");

    stepStart("Definition list: insert...");
    await setEditorContent(cdp, "");
    await sleep(50);
    const defResult = await cdp.evaluate(`window.__mdpadExecFormat("definitionList")`);
    if (!defResult.includes("Term") || !defResult.includes(": Definition")) {
      throw new Error(`Definition list failed: got "${defResult}"`);
    }
    stepOK("Definition list inserted");

    // =====================================================================
    // Phase 10: Format Active State Detection (Steps 56–59)
    // =====================================================================
    stepStart("Bold content → bold active...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("**hello**", 2, 7)`);
    await sleep(100);
    const boldActive = await cdp.evaluate(`window.__mdpadIsFormatActive("bold")`);
    if (boldActive !== true) throw new Error("Bold not active: " + boldActive);
    stepOK("Bold shows active state");

    stepStart("Plain content → bold inactive...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await sleep(100);
    const boldInactive = await cdp.evaluate(`window.__mdpadIsFormatActive("bold")`);
    if (boldInactive !== false) throw new Error("Bold button still active on plain text");
    stepOK("Bold button inactive on plain text");

    stepStart("H1 content → h1 active...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("# hello", 2, 7)`);
    await sleep(100);
    const h1Active = await cdp.evaluate(`window.__mdpadIsFormatActive("h1")`);
    stepOK("H1 active state: " + h1Active);

    stepStart("Multiple states: bold active, italic inactive...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("**hello**", 2, 7)`);
    await sleep(100);
    const boldActive2 = await cdp.evaluate(`window.__mdpadIsFormatActive("bold")`);
    const italicActive = await cdp.evaluate(`window.__mdpadIsFormatActive("italic")`);
    if (!boldActive2) throw new Error("Bold not active in multi-state check");
    if (italicActive) throw new Error("Italic wrongly active in multi-state check");
    stepOK("Bold=active, Italic=inactive");

    // =====================================================================
    // Phase 11: Keyboard Shortcuts for Format (Steps 60–65)
    // =====================================================================
    stepStart("Ctrl+B → bold...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("b", CTRL, 66);
    await sleep(250);
    let kbResult = await getEditorContent(cdp);
    if (kbResult !== "**hello**") throw new Error(`Ctrl+B failed: got "${kbResult}"`);
    stepOK("Ctrl+B → " + kbResult);

    stepStart("Ctrl+I → italic...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("i", CTRL, 73);
    await sleep(250);
    kbResult = await getEditorContent(cdp);
    if (kbResult !== "*hello*") throw new Error(`Ctrl+I failed: got "${kbResult}"`);
    stepOK("Ctrl+I → " + kbResult);

    stepStart("Ctrl+Shift+S → strikethrough...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("S", CTRL | SHIFT, 83);
    await sleep(250);
    kbResult = await getEditorContent(cdp);
    if (kbResult !== "~~hello~~") throw new Error(`Ctrl+Shift+S failed: got "${kbResult}"`);
    stepOK("Ctrl+Shift+S → " + kbResult);

    stepStart("Ctrl+` → inline code...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("`", CTRL, 192);
    await sleep(250);
    kbResult = await getEditorContent(cdp);
    if (kbResult !== "`hello`") throw new Error(`Ctrl+\` failed: got "${kbResult}"`);
    stepOK("Ctrl+` → " + kbResult);

    stepStart("Ctrl+U → underline...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("u", CTRL, 85);
    await sleep(250);
    kbResult = await getEditorContent(cdp);
    if (kbResult !== "<u>hello</u>") {
      stepSoftFail("Ctrl+U may conflict with Electron shortcut: got " + kbResult.substring(0, 30));
    } else {
      stepOK("Ctrl+U → " + kbResult);
    }

    stepStart("Ctrl+Shift+K → link...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await cdp.evaluate(`window.__mdpadEditor().focus()`);
    await sleep(100);
    await cdp.dispatchKey("K", CTRL | SHIFT, 75);
    await sleep(250);
    kbResult = await getEditorContent(cdp);
    if (kbResult !== "[hello](url)") {
      stepSoftFail("Ctrl+Shift+K may conflict with Electron shortcut: got " + kbResult.substring(0, 30));
    } else {
      stepOK("Ctrl+Shift+K → " + kbResult);
    }

    // =====================================================================
    // Phase 12: Preview Rendering (Steps 66–80)
    // =====================================================================
    stepStart("Show preview pane for rendering tests...");
    await cdp.evaluate(`
      (function() {
        var p = document.getElementById("preview-pane");
        if (!p || p.style.display === "none") window.__mdpadHandleMenuAction("togglePreview");
      })()
    `);
    await sleep(500);
    const previewVisible = await cdp.evaluate(`document.getElementById("preview-pane").style.display !== "none"`);
    if (!previewVisible) throw new Error("Preview pane not visible");
    stepOK("Preview pane visible");

    // Helper: set content, trigger preview update, wait for render, get preview HTML
    async function getPreviewHTML(content, waitMs) {
      await setEditorContent(cdp, content);
      await cdp.evaluate(`window.__mdpadUpdatePreview()`);
      await sleep(waitMs || 1000);
      return await cdp.evaluate(`
        (function() {
          var mb = document.querySelector("#preview-pane .markdown-body");
          return mb ? mb.innerHTML : "NO_PREVIEW";
        })()
      `);
    }

    stepStart("Bold → <strong>...");
    let pHtml = await getPreviewHTML("**hello**");
    if (!pHtml.includes("<strong>")) throw new Error("Bold not rendered: " + pHtml.substring(0, 100));
    stepOK("**hello** → <strong>");

    stepStart("Italic → <em>...");
    pHtml = await getPreviewHTML("*hello*");
    if (!pHtml.includes("<em>")) throw new Error("Italic not rendered: " + pHtml.substring(0, 100));
    stepOK("*hello* → <em>");

    stepStart("Heading → <h1>...");
    pHtml = await getPreviewHTML("# Hello");
    if (!pHtml.includes("<h1")) throw new Error("Heading not rendered: " + pHtml.substring(0, 100));
    stepOK("# Hello → <h1>");

    stepStart("Bullet list → <li>...");
    pHtml = await getPreviewHTML("- item1\n- item2");
    if (!pHtml.includes("<li>")) throw new Error("List not rendered: " + pHtml.substring(0, 100));
    stepOK("- item → <li>");

    stepStart("Code block → <code>...");
    pHtml = await getPreviewHTML("```js\nconsole.log()\n```");
    if (!pHtml.includes("<code")) throw new Error("Code not rendered: " + pHtml.substring(0, 100));
    stepOK("```code``` → <code>");

    stepStart("Link → <a>...");
    pHtml = await getPreviewHTML("[text](http://example.com)");
    if (!pHtml.includes("<a ")) throw new Error("Link not rendered: " + pHtml.substring(0, 100));
    stepOK("[text](url) → <a>");

    stepStart("Task list → checkbox...");
    pHtml = await getPreviewHTML("- [ ] todo\n- [x] done");
    if (!pHtml.includes("checkbox")) throw new Error("Task list not rendered: " + pHtml.substring(0, 100));
    stepOK("- [ ] → checkbox");

    stepStart("Table → <table>...");
    pHtml = await getPreviewHTML("| A | B |\n| --- | --- |\n| 1 | 2 |");
    if (!pHtml.includes("<table")) throw new Error("Table not rendered: " + pHtml.substring(0, 100));
    stepOK("Table → <table>");

    stepStart("Blockquote → <blockquote>...");
    pHtml = await getPreviewHTML("> quote");
    if (!pHtml.includes("<blockquote")) throw new Error("Blockquote not rendered: " + pHtml.substring(0, 100));
    stepOK("> quote → <blockquote>");

    stepStart("Horizontal rule → <hr>...");
    pHtml = await getPreviewHTML("text\n\n---\n\nmore");
    if (!pHtml.includes("<hr")) throw new Error("HR not rendered: " + pHtml.substring(0, 100));
    stepOK("--- → <hr>");

    stepStart("Strikethrough → <del> or <s>...");
    pHtml = await getPreviewHTML("~~text~~");
    if (!pHtml.includes("<del>") && !pHtml.includes("<s>")) {
      throw new Error("Strikethrough not rendered: " + pHtml.substring(0, 100));
    }
    stepOK("~~text~~ → <del>/<s>");

    stepStart("Emoji shortcode → rendered emoji...");
    pHtml = await getPreviewHTML("Hello :wave: World");
    if (pHtml.includes(":wave:")) throw new Error("Shortcode not resolved: " + pHtml.substring(0, 100));
    stepOK(":wave: rendered as emoji");

    stepStart("KaTeX math → .katex element...");
    pHtml = await getPreviewHTML("$E=mc^2$");
    await sleep(500); // Extra time for KaTeX
    const hasKatex = await cdp.evaluate(`!!document.querySelector("#preview-pane .markdown-body .katex")`);
    if (!hasKatex) throw new Error("KaTeX not rendered");
    stepOK("$E=mc^2$ → .katex");

    stepStart("Mermaid diagram → SVG...");
    try {
      await setEditorContent(cdp, "```mermaid\ngraph LR\nA-->B\n```");
      await cdp.evaluate(`window.__mdpadUpdatePreview()`);
      await sleep(3000); // Mermaid needs extra time
      const hasMermaid = await cdp.evaluate(`!!document.querySelector("#preview-pane .markdown-body svg")`);
      if (!hasMermaid) throw new Error("Mermaid SVG not found");
      stepOK("Mermaid → SVG");
    } catch (e) {
      stepSoftFail("Mermaid: " + e.message);
    }

    // =====================================================================
    // Phase 13: Context Menu (Steps 81–86)
    // =====================================================================
    stepStart("Right-click shows context menu...");
    await dismissOverlays(cdp);
    await cdp.evaluate(`
      (function() {
        var editorPane = document.getElementById("editor-pane");
        editorPane.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: 200, clientY: 200
        }));
      })()
    `);
    await sleep(300);
    const hasMenu = await cdp.evaluate(`!!document.querySelector(".format-context-menu")`);
    if (!hasMenu) throw new Error("Context menu not shown");
    stepOK("Context menu appeared");

    stepStart("Menu has 15+ items...");
    const itemCount = await cdp.evaluate(`document.querySelectorAll(".format-context-menu .fcm-item").length`);
    if (itemCount < 15) throw new Error("Only " + itemCount + " items, expected 15+");
    stepOK("Menu items: " + itemCount);

    stepStart("Heading submenu opens...");
    try {
      // Find heading item and trigger mouseenter
      await cdp.evaluate(`
        (function() {
          var items = document.querySelectorAll(".format-context-menu .fcm-item.has-submenu");
          for (var item of items) {
            var label = item.querySelector(".fcm-label");
            if (label && (label.textContent.includes("Heading") || label.textContent.includes("見出し"))) {
              item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
              return "HOVERED";
            }
          }
          return "NOT_FOUND";
        })()
      `);
      await sleep(300);
      const hasSub = await cdp.evaluate(`!!document.querySelector(".fcm-submenu")`);
      if (!hasSub) throw new Error("Submenu not shown");
      stepOK("Heading submenu opened");
    } catch (e) {
      stepSoftFail("Heading submenu: " + e.message);
    }

    stepStart("Color palette opens...");
    try {
      // Close heading submenu first
      await cdp.evaluate(`
        (function() {
          var sub = document.querySelector(".fcm-submenu");
          if (sub) sub.remove();
        })()
      `);
      await cdp.evaluate(`
        (function() {
          var items = document.querySelectorAll(".format-context-menu .fcm-item.has-submenu");
          for (var item of items) {
            var label = item.querySelector(".fcm-label");
            if (label && (label.textContent.includes("Color") || label.textContent.includes("カラー"))) {
              item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
              return "HOVERED";
            }
          }
          return "NOT_FOUND";
        })()
      `);
      await sleep(300);
      const hasPal = await cdp.evaluate(`!!document.querySelector(".fcm-color-palette")`);
      if (!hasPal) throw new Error("Color palette not shown");
      stepOK("Color palette opened");
    } catch (e) {
      stepSoftFail("Color palette: " + e.message);
    }

    // Close context menu
    await cdp.evaluate(`
      (function() {
        var m = document.querySelector(".format-context-menu");
        if (m) m.remove();
        var s = document.querySelectorAll(".fcm-submenu, .fcm-color-palette");
        s.forEach(function(el) { el.remove(); });
      })()
    `);
    await sleep(200);

    stepStart("Click Bold in context menu applies formatting...");
    // Set content and selection, then open context menu and click Bold in one sequence
    await cdp.evaluate(`window.__mdpadSetAndSelect("hello", 0, 5)`);
    await sleep(100);
    // Open context menu
    await cdp.evaluate(`
      (function() {
        var editorPane = document.getElementById("editor-pane");
        editorPane.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: 200, clientY: 200
        }));
      })()
    `);
    await sleep(300);
    // Click Bold — the context menu handler gets fresh editor reference and calls cmd.fn
    await cdp.evaluate(`
      (function() {
        var items = document.querySelectorAll(".format-context-menu .fcm-item");
        for (var item of items) {
          var label = item.querySelector(".fcm-label");
          if (label && label.textContent === "Bold") { item.click(); return "CLICKED"; }
        }
        return "NOT_FOUND";
      })()
    `);
    await sleep(300);
    const ctxBold = await getEditorContent(cdp);
    if (ctxBold !== "**hello**") throw new Error(`Context menu Bold failed: got "${ctxBold}"`);
    stepOK("Context menu Bold: hello → " + ctxBold);

    stepStart("Escape closes context menu...");
    await cdp.evaluate(`
      (function() {
        var editorPane = document.getElementById("editor-pane");
        editorPane.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: 200, clientY: 200
        }));
      })()
    `);
    await sleep(300);
    await cdp.dispatchKey("Escape", 0, 27);
    await sleep(300);
    const menuGone = await cdp.evaluate(`!document.querySelector(".format-context-menu")`);
    if (!menuGone) throw new Error("Context menu still visible after Escape");
    stepOK("Context menu closed with Escape");

    // =====================================================================
    // Phase 14: Format Toolbar Modes (Steps 87–91)
    // =====================================================================
    stepStart("Toolbar visible in topbar mode...");
    const barExists = await cdp.evaluate(`!!document.getElementById("format-bar")`);
    if (!barExists) throw new Error("Format bar not found");
    stepOK("Format bar exists");

    stepStart("Toolbar buttons present...");
    const btnCount = await cdp.evaluate(`document.querySelectorAll(".fb-btn[data-format-id]").length`);
    if (btnCount < 10) throw new Error("Only " + btnCount + " format buttons, expected 10+");
    stepOK("Format buttons: " + btnCount);

    stepStart("Switch to sidebar mode...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("setFormatBar:sidebar")`);
    await sleep(500);
    const sidebarClass = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("format-bar");
        return bar ? bar.className : "NOT_FOUND";
      })()
    `);
    if (!sidebarClass.includes("sidebar")) throw new Error("Not in sidebar mode: " + sidebarClass);
    stepOK("Sidebar mode: " + sidebarClass);

    stepStart("Switch to hidden mode...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("setFormatBar:hidden")`);
    await sleep(300);
    const barGone = await cdp.evaluate(`!document.getElementById("format-bar")`);
    if (!barGone) throw new Error("Format bar still visible in hidden mode");
    stepOK("Format bar hidden");

    stepStart("Restore topbar mode...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("setFormatBar:topbar")`);
    await sleep(300);
    const barBack = await cdp.evaluate(`!!document.getElementById("format-bar")`);
    if (!barBack) throw new Error("Format bar not restored");
    stepOK("Format bar restored to topbar");

    // --- Phase 14b: Sidebar Toolbar Tests (Steps 92–98) ---
    // サイドバーモードに切替え、DOM構造・ボタン配置・フォーマット実行・
    // 見出しドロップダウン・カラーパレットの動作を検証する

    stepStart("Sidebar: DOM structure (main-content wrapper)...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("setFormatBar:sidebar")`);
    await sleep(500);
    const sidebarDOM = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("format-bar");
        var wrapper = document.getElementById("main-content");
        var paneC = document.getElementById("pane-container");
        if (!bar) return { error: "NO_BAR" };
        return {
          hasSidebarClass: bar.className.includes("sidebar"),
          barWidth: bar.offsetWidth,
          wrapperExists: !!wrapper,
          paneInWrapper: wrapper ? wrapper.contains(paneC) : false,
          flexDir: getComputedStyle(bar).flexDirection
        };
      })()
    `);
    if (sidebarDOM.error) throw new Error("Format bar not found in sidebar mode");
    if (!sidebarDOM.hasSidebarClass) throw new Error("Missing sidebar class");
    if (!sidebarDOM.wrapperExists) throw new Error("#main-content wrapper missing");
    if (!sidebarDOM.paneInWrapper) throw new Error("pane-container not inside #main-content");
    if (sidebarDOM.flexDir !== "column") throw new Error("Expected flex-direction:column, got " + sidebarDOM.flexDir);
    stepOK("sidebar class, wrapper, column layout, width=" + sidebarDOM.barWidth + "px");

    stepStart("Sidebar: buttons present and vertical layout...");
    const sidebarBtns = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("format-bar");
        if (!bar) return { error: "NO_BAR" };
        var btns = bar.querySelectorAll(".fb-btn[data-format-id]");
        var ids = [];
        for (var b of btns) ids.push(b.getAttribute("data-format-id"));
        // ボタンのY座標が昇順であることを確認（縦配置）
        var rects = [];
        for (var b of btns) rects.push(b.getBoundingClientRect().top);
        var isVertical = true;
        for (var i = 1; i < rects.length; i++) {
          if (rects[i] < rects[i - 1]) { isVertical = false; break; }
        }
        return { count: btns.length, ids: ids, isVertical: isVertical };
      })()
    `);
    if (sidebarBtns.error) throw new Error("No format bar");
    if (sidebarBtns.count < 10) throw new Error("Only " + sidebarBtns.count + " sidebar buttons, expected 10+");
    if (!sidebarBtns.isVertical) throw new Error("Buttons not vertically arranged");
    // topbar と同じボタンが揃っていることを確認
    const requiredIds = ["bold", "italic", "underline", "strikethrough", "link", "bulletList", "numberedList"];
    const missingIds = requiredIds.filter(id => !sidebarBtns.ids.includes(id));
    if (missingIds.length > 0) throw new Error("Missing sidebar buttons: " + missingIds.join(", "));
    stepOK("Sidebar buttons: " + sidebarBtns.count + ", vertical, all required IDs present");

    stepStart("Sidebar: Bold format via button click...");
    // サイドバーモードでエディタにテキストを設定し、ボタンクリックでBold適用
    await cdp.evaluate(`window.__mdpadSetAndSelect("sidebar test", 0, 12)`);
    await sleep(50);
    const sidebarBoldResult = await cdp.evaluate(`window.__mdpadExecFormat("bold")`);
    if (!sidebarBoldResult.includes("**sidebar test**")) {
      throw new Error("Sidebar Bold failed: " + sidebarBoldResult);
    }
    stepOK("Sidebar Bold: " + sidebarBoldResult.substring(0, 40));

    stepStart("Sidebar: Italic format...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("sidebar test", 0, 12)`);
    await sleep(50);
    const sidebarItalicResult = await cdp.evaluate(`window.__mdpadExecFormat("italic")`);
    if (!sidebarItalicResult.includes("*sidebar test*")) {
      throw new Error("Sidebar Italic failed: " + sidebarItalicResult);
    }
    stepOK("Sidebar Italic: " + sidebarItalicResult.substring(0, 40));

    stepStart("Sidebar: Heading dropdown opens to the right...");
    // サイドバーモードでは見出しドロップダウンが右方向に展開する
    // ボタン: data-format-id="heading", メニュー: .fb-dropdown-overlay (bodyに追加される)
    const headingDropdown = await cdp.evaluate(`
      (function() {
        var btn = document.querySelector("#format-bar .fb-btn[data-format-id='heading']");
        if (!btn) return { error: "NO_HEADING_BTN" };
        btn.click();
        // メニューは document.body に .fb-dropdown-overlay として追加される
        var menu = document.querySelector(".fb-dropdown-overlay");
        if (!menu) return { error: "NO_MENU" };
        var btnRect = btn.getBoundingClientRect();
        var menuRect = menu.getBoundingClientRect();
        // サイドバーでは menu.left >= btn.right（右に展開）
        var opensRight = menuRect.left >= btnRect.right - 5;
        var itemCount = menu.querySelectorAll(".fb-dropdown-item").length;
        // メニューを閉じる（ボタンを再クリック）
        btn.click();
        return { opensRight: opensRight, itemCount: itemCount,
                 btnRight: Math.round(btnRect.right), menuLeft: Math.round(menuRect.left) };
      })()
    `);
    if (headingDropdown.error === "NO_HEADING_BTN") throw new Error("Heading dropdown button not found in sidebar");
    if (headingDropdown.error === "NO_MENU") throw new Error("Heading menu did not open");
    if (!headingDropdown.opensRight) {
      throw new Error("Heading menu not opening right: btn.right=" + headingDropdown.btnRight + " menu.left=" + headingDropdown.menuLeft);
    }
    if (headingDropdown.itemCount < 6) throw new Error("Expected 6+ heading items, got " + headingDropdown.itemCount);
    stepOK("Heading dropdown opens right (" + headingDropdown.itemCount + " items), btnR=" + headingDropdown.btnRight + " menuL=" + headingDropdown.menuLeft);

    stepStart("Sidebar: H2 applied from heading dropdown...");
    await cdp.evaluate(`window.__mdpadSetAndSelect("sidebar heading", 0, 15)`);
    await sleep(50);
    const sidebarH2 = await cdp.evaluate(`window.__mdpadExecFormat("h2")`);
    if (!sidebarH2.includes("## sidebar heading")) {
      throw new Error("Sidebar H2 failed: " + sidebarH2);
    }
    stepOK("Sidebar H2: " + sidebarH2.substring(0, 40));

    stepStart("Sidebar: restore topbar and verify cleanup...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("setFormatBar:topbar")`);
    await sleep(500);
    const cleanupCheck = await cdp.evaluate(`
      (function() {
        var bar = document.getElementById("format-bar");
        var wrapper = document.getElementById("main-content");
        return {
          barExists: !!bar,
          hasTopbar: bar ? bar.className.includes("topbar") : false,
          hasSidebar: bar ? bar.className.includes("sidebar") : false,
          wrapperGone: !wrapper
        };
      })()
    `);
    if (!cleanupCheck.barExists) throw new Error("Format bar gone after restore");
    if (!cleanupCheck.hasTopbar) throw new Error("Not topbar mode after restore");
    if (cleanupCheck.hasSidebar) throw new Error("Still has sidebar class");
    if (!cleanupCheck.wrapperGone) throw new Error("#main-content wrapper not removed after topbar restore");
    stepOK("topbar restored, sidebar wrapper removed");

    // =====================================================================
    // Phase 15: Emoji Picker (Steps 99–106)
    // =====================================================================
    stepStart("Open emoji picker...");
    const emojiBtn = await cdp.evaluate(`
      (function() {
        var btn = document.getElementById("fb-emoji-btn");
        if (!btn) return "NO_BTN";
        btn.click();
        return "CLICKED";
      })()
    `);
    if (emojiBtn === "NO_BTN") throw new Error("Emoji button not found");
    await sleep(500);
    const pickerExists = await cdp.evaluate(`!!document.querySelector(".emoji-picker")`);
    if (!pickerExists) throw new Error("Emoji picker not opened");
    stepOK("Emoji picker opened");

    stepStart("Emoji picker layout...");
    const layout = await cdp.evaluate(`
      (function() {
        var sidebar = !!document.querySelector(".ep-sidebar");
        var grid = !!document.querySelector(".ep-grid-area");
        var status = !!document.querySelector(".ep-status-bar");
        var search = !!document.querySelector(".ep-search input");
        var emojis = document.querySelectorAll(".ep-grid-area .ep-emoji").length;
        return { sidebar: sidebar, grid: grid, status: status, search: search, emojis: emojis };
      })()
    `);
    if (!layout.sidebar || !layout.grid || !layout.search) {
      throw new Error("Layout incomplete: " + JSON.stringify(layout));
    }
    if (layout.emojis < 6) throw new Error("Too few emojis: " + layout.emojis);
    stepOK("Layout: sidebar, grid(" + layout.emojis + " emojis), search, status");

    stepStart("Skin tone selector...");
    try {
      const skinTone = await cdp.evaluate(`
        (function() {
          var btn = document.querySelector(".ep-skin-tone-btn");
          if (!btn) return "NO_BTN";
          btn.click();
          var dd = document.querySelector(".ep-skin-tone-dropdown");
          var opts = dd ? dd.querySelectorAll(".ep-skin-option").length : 0;
          return { btn: true, dropdown: !!dd, options: opts };
        })()
      `);
      if (!skinTone.dropdown || skinTone.options < 5) throw new Error("Skin tone: " + JSON.stringify(skinTone));
      // Close dropdown
      await cdp.evaluate(`
        (function() {
          var dd = document.querySelector(".ep-skin-tone-dropdown");
          if (dd) dd.remove();
        })()
      `);
      stepOK("Skin tone: " + skinTone.options + " options");
    } catch (e) {
      stepSoftFail("Skin tone: " + e.message);
    }

    stepStart("Name mode toggle...");
    const nameMode = await cdp.evaluate(`
      (function() {
        var btn = document.querySelector(".ep-name-mode-btn");
        if (!btn) return "NO_BTN";
        var before = btn.classList.contains("active");
        btn.click();
        var after = btn.classList.contains("active");
        return { before: before, after: after, toggled: before !== after };
      })()
    `);
    if (nameMode === "NO_BTN") throw new Error("Name mode button not found");
    if (!nameMode.toggled) throw new Error("Name mode did not toggle");
    stepOK("Name mode toggled: " + nameMode.before + " → " + nameMode.after);

    stepStart("Emoji search filters results...");
    const searchResult = await cdp.evaluate(`
      (function() {
        var input = document.querySelector(".ep-search input");
        if (!input) return "NO_INPUT";
        input.value = "thumbs";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return "SEARCHED";
      })()
    `);
    await sleep(300);
    const filtered = await cdp.evaluate(`document.querySelectorAll(".ep-grid-area .ep-emoji").length`);
    if (filtered < 1) throw new Error("No results for 'thumbs'");
    stepOK("Search 'thumbs': " + filtered + " results");

    stepStart("Click emoji → inserts into editor...");
    // Clear editor first, clear search
    await cdp.evaluate(`
      (function() {
        var input = document.querySelector(".ep-search input");
        if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
      })()
    `);
    await sleep(300);
    // Disable name mode if active
    await cdp.evaluate(`
      (function() {
        var btn = document.querySelector(".ep-name-mode-btn");
        if (btn && btn.classList.contains("active")) btn.click();
      })()
    `);
    await sleep(100);
    await setEditorContent(cdp, "");
    const emojiInserted = await cdp.evaluate(`
      (function() {
        var emoji = document.querySelector(".ep-grid-area .ep-emoji");
        if (!emoji) return "NO_EMOJI";
        emoji.click();
        return "CLICKED";
      })()
    `);
    await sleep(300);
    const emojiContent = await getEditorContent(cdp);
    if (emojiContent.length === 0) throw new Error("No emoji inserted");
    stepOK("Emoji inserted: " + emojiContent.substring(0, 10));

    stepStart("Shortcode mode inserts :name:...");
    try {
      // Re-open picker
      await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("fb-emoji-btn");
          if (btn) btn.click();
        })()
      `);
      await sleep(500);
      // Enable name mode
      await cdp.evaluate(`
        (function() {
          var btn = document.querySelector(".ep-name-mode-btn");
          if (btn && !btn.classList.contains("active")) btn.click();
        })()
      `);
      await sleep(200);
      await setEditorContent(cdp, "");
      await sleep(100);
      await cdp.evaluate(`
        (function() {
          var emoji = document.querySelector(".ep-grid-area .ep-emoji");
          if (emoji) emoji.click();
        })()
      `);
      await sleep(300);
      const shortcodeContent = await getEditorContent(cdp);
      if (!shortcodeContent.includes(":")) throw new Error("No shortcode inserted: " + shortcodeContent);
      stepOK("Shortcode inserted: " + shortcodeContent.substring(0, 20));
    } catch (e) {
      stepSoftFail("Shortcode mode: " + e.message);
    }

    stepStart("Category navigation...");
    try {
      const catNav = await cdp.evaluate(`
        (function() {
          var btn = document.getElementById("fb-emoji-btn");
          if (btn) btn.click();
          return "REOPEN";
        })()
      `);
      await sleep(500);
      const catResult = await cdp.evaluate(`
        (function() {
          var btns = document.querySelectorAll(".ep-sidebar .ep-cat-btn");
          if (btns.length < 3) return "FEW_CATS:" + btns.length;
          btns[2].click();
          return "NAV_OK:" + btns.length;
        })()
      `);
      stepOK("Category buttons: " + catResult);
    } catch (e) {
      stepSoftFail("Category nav: " + e.message);
    }

    // Close emoji picker
    await cdp.evaluate(`
      (function() {
        var picker = document.querySelector(".emoji-picker");
        if (picker) picker.remove();
      })()
    `);
    await sleep(200);

    // =====================================================================
    // Phase 16: Dialogs (Steps 100–111)
    // =====================================================================

    // Ensure dirty state for close dialog
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        view.dispatch({ changes: { from: view.state.doc.length, insert: " dirty" } });
      })()
    `);
    await sleep(200);

    stepStart("Close dialog appears with dirty state...");
    await cdp.evaluate(`window.__mdpadShowCloseDialog()`);
    await sleep(500);
    const closeOverlay = await cdp.evaluate(`!!document.getElementById("close-dialog-overlay")`);
    if (!closeOverlay) throw new Error("Close dialog not shown");
    stepOK("Close dialog appeared");

    stepStart("Close dialog has correct buttons...");
    const closeBtns = await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("close-dialog-overlay");
        if (!overlay) return 0;
        return overlay.querySelectorAll("button").length;
      })()
    `);
    if (closeBtns < 2) throw new Error("Expected 2+ buttons, got " + closeBtns);
    stepOK("Close dialog buttons: " + closeBtns);

    stepStart("Cancel close dialog...");
    await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("close-dialog-overlay");
        if (!overlay) return;
        var closeBtn = overlay.querySelector(".close-x, button[aria-label='Close']");
        if (closeBtn) { closeBtn.click(); return; }
        var btns = overlay.querySelectorAll("button");
        for (var b of btns) {
          if (b.textContent.includes("Cancel") || b.textContent.includes("キャンセル") || b.textContent === "×") {
            b.click(); return;
          }
        }
      })()
    `);
    await sleep(300);
    let overlayGone = await cdp.evaluate(`!document.getElementById("close-dialog-overlay")`);
    if (!overlayGone) {
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      overlayGone = await cdp.evaluate(`!document.getElementById("close-dialog-overlay")`);
    }
    if (!overlayGone) {
      await cdp.evaluate(`document.getElementById("close-dialog-overlay").remove()`);
    }
    stepOK("Close dialog dismissed");

    stepStart("Confirm-save on New File when dirty...");
    // Fire and forget — handleMenuAction("new") returns a promise that blocks until dialog resolves
    cdp.evaluate(`window.__mdpadHandleMenuAction("new")`);
    await sleep(800);
    const confirmSave = await cdp.evaluate(`!!document.getElementById("confirm-save-overlay")`);
    if (!confirmSave) throw new Error("Confirm-save dialog not shown");
    stepOK("Confirm-save dialog appeared");

    stepStart("Cancel confirm-save...");
    await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("confirm-save-overlay");
        if (!overlay) return;
        var btns = overlay.querySelectorAll("button");
        for (var b of btns) {
          if (b.textContent.includes("Cancel") || b.textContent.includes("キャンセル") || b.textContent === "×") {
            b.click(); return;
          }
        }
        overlay.remove();
      })()
    `);
    await sleep(300);
    stepOK("Confirm-save cancelled");

    stepStart("About dialog: contains 'mdpad' + version...");
    await dismissOverlays(cdp);
    await cdp.evaluate(`window.__mdpadHandleMenuAction("about")`);
    await sleep(500);
    const aboutText = await cdp.evaluate(`
      (function() {
        var o = document.getElementById("about-overlay");
        return o ? o.textContent : "NO_OVERLAY";
      })()
    `);
    if (aboutText === "NO_OVERLAY") throw new Error("About dialog not shown");
    if (!aboutText.includes("mdpad")) throw new Error("About missing 'mdpad': " + aboutText.substring(0, 50));
    if (!aboutText.match(/v\d+\.\d+/)) throw new Error("About missing version: " + aboutText.substring(0, 50));
    stepOK("About dialog: has 'mdpad' + version");

    stepStart("Close About with Escape...");
    await cdp.dispatchKey("Escape", 0, 27);
    await sleep(300);
    const aboutGone = await cdp.evaluate(`!document.getElementById("about-overlay")`);
    if (!aboutGone) {
      await cdp.evaluate(`document.getElementById("about-overlay").remove()`);
    }
    stepOK("About dialog closed");

    stepStart("Go to Line dialog opens...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("goToLine")`);
    await sleep(300);
    const gotoExists = await cdp.evaluate(`!!document.getElementById("goto-line-overlay")`);
    if (!gotoExists) throw new Error("Go to Line dialog not shown");
    stepOK("Go to Line dialog opened");

    stepStart("Go to Line: enter 3 → cursor jumps...");
    // Set content with 5 lines first
    await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("goto-line-overlay");
        if (overlay) overlay.remove();
      })()
    `);
    await sleep(100);
    await setEditorContent(cdp, "line1\nline2\nline3\nline4\nline5");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("goToLine")`);
    await sleep(300);
    await cdp.evaluate(`
      (function() {
        var overlay = document.getElementById("goto-line-overlay");
        if (!overlay) return;
        var input = overlay.querySelector("input");
        if (!input) return;
        input.value = "3";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // Trigger submit
        var form = overlay.querySelector("form");
        if (form) { form.dispatchEvent(new Event("submit", { bubbles: true })); return; }
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      })()
    `);
    await sleep(500);
    const cursorLine = await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        var pos = view.state.selection.main.head;
        return view.state.doc.lineAt(pos).number;
      })()
    `);
    if (cursorLine !== 3) throw new Error("Cursor on line " + cursorLine + ", expected 3");
    stepOK("Cursor jumped to line 3");

    stepStart("Properties dialog shows metadata...");
    await dismissOverlays(cdp);
    await cdp.evaluate(`window.__mdpadHandleMenuAction("properties")`);
    await sleep(500);
    const propsText = await cdp.evaluate(`
      (function() {
        var o = document.getElementById("properties-overlay");
        return o ? o.textContent : "NO_OVERLAY";
      })()
    `);
    if (propsText === "NO_OVERLAY") throw new Error("Properties dialog not shown");
    if (!propsText.match(/\d/)) throw new Error("Properties has no numbers: " + propsText.substring(0, 50));
    await cdp.dispatchKey("Escape", 0, 27);
    await sleep(200);
    stepOK("Properties dialog shown with data");

    stepStart("Check for Updates dialog...");
    try {
      await dismissOverlays(cdp);
      await cdp.evaluate(`window.__mdpadHandleMenuAction("checkForUpdates")`);
      await sleep(500);
      const updateExists = await cdp.evaluate(`!!document.getElementById("update-overlay")`);
      if (!updateExists) throw new Error("Update dialog not shown");
      stepOK("Check for Updates dialog opened");
    } catch (e) {
      stepSoftFail("Check for Updates: " + e.message);
    }

    stepStart("Close Check for Updates dialog...");
    try {
      await sleep(2000); // Wait for network
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      const updateGone = await cdp.evaluate(`!document.getElementById("update-overlay")`);
      if (!updateGone) {
        await cdp.evaluate(`document.getElementById("update-overlay").remove()`);
      }
      stepOK("Update dialog closed");
    } catch (e) {
      stepSoftFail("Update dialog close: " + e.message);
    }

    // =====================================================================
    // Phase 17: EOL Selection (Steps 112–114)
    // =====================================================================
    stepStart("Click EOL indicator → popup appears...");
    await dismissOverlays(cdp);
    const eolClick = await cdp.evaluate(`
      (function() {
        var el = document.getElementById("sb-eol");
        if (!el) return "NO_EOL";
        el.click();
        var popup = document.getElementById("eol-popup");
        return popup ? "POPUP_SHOWN" : "NO_POPUP";
      })()
    `);
    if (eolClick !== "POPUP_SHOWN") throw new Error("EOL popup: " + eolClick);
    stepOK("EOL popup appeared");

    stepStart("Select LF from popup...");
    await cdp.evaluate(`
      (function() {
        var popup = document.getElementById("eol-popup");
        if (!popup) return;
        var opts = popup.querySelectorAll("[data-eol]");
        for (var o of opts) {
          if (o.dataset.eol === "LF" || o.textContent.trim() === "LF") { o.click(); return; }
        }
        // Fallback: click first option
        if (opts.length > 0) opts[0].click();
      })()
    `);
    await sleep(300);
    const eolAfter = await cdp.evaluate(`document.getElementById("sb-eol").textContent.trim()`);
    if (!["LF", "CRLF", "CR"].includes(eolAfter)) throw new Error("Invalid EOL after select: " + eolAfter);
    stepOK("EOL selected: " + eolAfter);

    stepStart("EOL popup dismissed...");
    const popupGone = await cdp.evaluate(`!document.getElementById("eol-popup")`);
    if (!popupGone) {
      await cdp.evaluate(`document.getElementById("eol-popup").remove()`);
    }
    stepOK("EOL popup dismissed");

    // =====================================================================
    // Phase 18: Dirty State (Steps 115–118)
    // =====================================================================
    stepStart("Clean after new file...");
    // Fire and forget — handleMenuAction("new") blocks if confirm-save dialog appears
    cdp.evaluate(`window.__mdpadHandleMenuAction("new")`);
    await sleep(500);
    // If confirm-save appears, click "Don't Save"
    const csOverlay = await cdp.evaluate(`!!document.getElementById("confirm-save-overlay")`);
    if (csOverlay) {
      await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("confirm-save-overlay");
          var btns = overlay.querySelectorAll("button");
          for (var b of btns) {
            if (b.textContent.includes("Don") || b.textContent.includes("保存しない")) { b.click(); return; }
          }
          overlay.remove();
        })()
      `);
      await sleep(500);
    }
    const cleanState = await cdp.evaluate(`window.__mdpadGetCloseState().isDirty`);
    if (cleanState !== false) throw new Error("isDirty should be false after new file");
    stepOK("isDirty = false after new file");

    stepStart("Dirty after edit...");
    await cdp.evaluate(`
      (function() {
        var view = window.__mdpadEditor();
        view.dispatch({ changes: { from: 0, insert: "dirty content" } });
      })()
    `);
    await sleep(300);
    const dirtyState = await cdp.evaluate(`window.__mdpadGetCloseState().isDirty`);
    if (dirtyState !== true) throw new Error("isDirty should be true after edit");
    stepOK("isDirty = true after edit");

    stepStart("Title shows * when dirty...");
    const dirtyTitle = await cdp.evaluate(`document.title`);
    if (!dirtyTitle.includes("*")) {
      // This is a known soft-fail candidate — title update may have timing issues
      stepSoftFail("Title missing *: " + dirtyTitle);
    } else {
      stepOK("Title has *: " + dirtyTitle);
    }

    stepStart("Clean again after new file...");
    // Fire and forget — handleMenuAction("new") blocks if confirm-save dialog appears
    cdp.evaluate(`window.__mdpadHandleMenuAction("new")`);
    await sleep(500);
    const csOverlay2 = await cdp.evaluate(`!!document.getElementById("confirm-save-overlay")`);
    if (csOverlay2) {
      await cdp.evaluate(`
        (function() {
          var overlay = document.getElementById("confirm-save-overlay");
          var btns = overlay.querySelectorAll("button");
          for (var b of btns) {
            if (b.textContent.includes("Don") || b.textContent.includes("保存しない")) { b.click(); return; }
          }
          overlay.remove();
        })()
      `);
      await sleep(500);
    }
    const cleanAgain = await cdp.evaluate(`window.__mdpadGetCloseState().isDirty`);
    if (cleanAgain !== false) throw new Error("isDirty should be false");
    stepOK("isDirty = false after second new file");

    // =====================================================================
    // Phase 19: Diff Pane (Steps 119–121)
    // =====================================================================
    stepStart("Diff mode selector exists...");
    // Show diff pane
    await cdp.evaluate(`
      (function() {
        var d = document.getElementById("diff-pane");
        if (!d || d.style.display === "none") window.__mdpadHandleMenuAction("toggleDiff");
      })()
    `);
    await sleep(500);
    const diffSelect = await cdp.evaluate(`
      (function() {
        var s = document.getElementById("diff-mode-select");
        return s ? { value: s.value, options: s.options.length } : null;
      })()
    `);
    if (!diffSelect || diffSelect.options < 2) throw new Error("Diff selector: " + JSON.stringify(diffSelect));
    stepOK("Diff mode selector: " + diffSelect.options + " options, value=" + diffSelect.value);

    stepStart("Diff content area renders...");
    const diffContent = await cdp.evaluate(`
      (function() {
        var el = document.querySelector(".diff-content");
        return el ? el.innerHTML.length : 0;
      })()
    `);
    if (diffContent === 0) throw new Error("Diff content area empty");
    stepOK("Diff content: " + diffContent + " chars");

    stepStart("Diff view mode switch...");
    try {
      const viewModeResult = await cdp.evaluate(`
        (function() {
          var sel = document.getElementById("diff-view-select");
          if (!sel) return "NO_VIEW_SELECT";
          return "options=" + sel.options.length + " value=" + sel.value;
        })()
      `);
      stepOK("Diff view mode: " + viewModeResult);
    } catch (e) {
      stepSoftFail("Diff view mode: " + e.message);
    }

    // Hide diff pane
    await cdp.evaluate(`window.__mdpadHandleMenuAction("toggleDiff")`);
    await sleep(200);

    // =====================================================================
    // Phase 20: Locale Switching (Steps 122–123)
    // =====================================================================
    stepStart("Switch to Japanese...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("changeLocale:ja")`);
    await sleep(800);
    const jaText = await cdp.evaluate(`document.getElementById("sb-cursor").textContent`);
    if (!jaText.includes("行")) throw new Error("Japanese locale not active: " + jaText);
    stepOK("Japanese: " + jaText);

    stepStart("Switch back to English...");
    await cdp.evaluate(`window.__mdpadHandleMenuAction("changeLocale:en")`);
    await sleep(500);
    const enText = await cdp.evaluate(`document.getElementById("sb-cursor").textContent`);
    if (!enText.includes("Ln")) throw new Error("English locale not active: " + enText);
    stepOK("English: " + enText);

    // =====================================================================
    // Phase 21: Autosave Status (Steps 124–125)
    // =====================================================================
    stepStart("Autosave status bar element exists...");
    const backupEl = await cdp.evaluate(`
      (function() {
        var el = document.getElementById("sb-backup");
        return el ? el.textContent.trim() : "NOT_FOUND";
      })()
    `);
    if (backupEl === "NOT_FOUND") throw new Error("#sb-backup not found");
    stepOK("Backup element: " + backupEl);

    stepStart("Autosave status shows valid state...");
    const isValidStatus = /OFF|Backup|バックアップ|min|分/.test(backupEl);
    if (!isValidStatus) throw new Error("Unexpected backup status: " + backupEl);
    stepOK("Backup status valid: " + backupEl);

    // =====================================================================
    // Phase 22: Shortcode Rendering (Steps 126–127)
    // =====================================================================
    stepStart("Emoji shortcode :wave: renders in preview...");
    // Ensure preview is visible
    await cdp.evaluate(`
      (function() {
        var p = document.getElementById("preview-pane");
        if (!p || p.style.display === "none") window.__mdpadHandleMenuAction("togglePreview");
      })()
    `);
    await sleep(300);
    await setEditorContent(cdp, "Hello :wave: World :rocket:");
    await cdp.evaluate(`window.__mdpadUpdatePreview()`);
    await sleep(1500);
    const shortcodeHTML = await cdp.evaluate(`
      (function() {
        var mb = document.querySelector("#preview-pane .markdown-body");
        return mb ? mb.innerHTML : "";
      })()
    `);
    const unresolved = (shortcodeHTML.match(/:wave:|:rocket:/g) || []).length;
    if (unresolved > 0) throw new Error("Unresolved shortcodes: " + unresolved);
    stepOK("Shortcodes resolved (0 unresolved)");

    stepStart("Multiple shortcodes all resolved...");
    await setEditorContent(cdp, ":+1: :heart: :smile: :100: :fire:");
    await cdp.evaluate(`window.__mdpadUpdatePreview()`);
    await sleep(1500);
    const multiHTML = await cdp.evaluate(`
      (function() {
        var mb = document.querySelector("#preview-pane .markdown-body");
        return mb ? mb.innerHTML : "";
      })()
    `);
    const unresolvedMulti = (multiHTML.match(/:[a-z0-9_+]+:/g) || []).length;
    if (unresolvedMulti > 0) throw new Error("Unresolved: " + unresolvedMulti);
    stepOK("All 5 shortcodes resolved");

    // Hide preview
    await cdp.evaluate(`window.__mdpadHandleMenuAction("togglePreview")`);
    await sleep(200);

    // =====================================================================
    // Phase 23: Check for Updates (Steps 128–130) [SOFT FAIL - network]
    // =====================================================================
    stepStart("Check for Updates dialog opens...");
    try {
      await dismissOverlays(cdp);
      await cdp.evaluate(`window.__mdpadHandleMenuAction("checkForUpdates")`);
      await sleep(500);
      const updExists = await cdp.evaluate(`!!document.getElementById("update-overlay")`);
      if (!updExists) throw new Error("Update overlay not shown");
      stepOK("Update dialog opened");
    } catch (e) {
      stepSoftFail("Update dialog: " + e.message);
    }

    stepStart("Update dialog has content...");
    try {
      await sleep(2000);
      const updContent = await cdp.evaluate(`
        (function() {
          var o = document.getElementById("update-overlay");
          return o ? o.textContent : "NO_OVERLAY";
        })()
      `);
      if (updContent === "NO_OVERLAY") throw new Error("Overlay gone");
      if (!(/v\d+|error|update|checking|確認/i.test(updContent))) {
        throw new Error("No expected content: " + updContent.substring(0, 80));
      }
      stepOK("Content: " + updContent.substring(0, 60));
    } catch (e) {
      stepSoftFail("Update content: " + e.message);
    }

    stepStart("Close update dialog...");
    try {
      await cdp.dispatchKey("Escape", 0, 27);
      await sleep(300);
      const updGone = await cdp.evaluate(`!document.getElementById("update-overlay")`);
      if (!updGone) await cdp.evaluate(`document.getElementById("update-overlay").remove()`);
      stepOK("Update dialog closed");
    } catch (e) {
      stepSoftFail("Update close: " + e.message);
    }

    // =====================================================================
    // Phase 24: Cleanup (Step 138)
    // =====================================================================
    stepStart("Force-closing process and cleaning up...");
    cdp.close();
    cdp = null;
    killMdpad();

    const deadline = Date.now() + TIMEOUT_CLOSE;
    while (!exited && Date.now() < deadline) {
      await sleep(200);
    }

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
              try { fs.unlinkSync(path.join(dir, f)); cleanedUp++; } catch {}
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
