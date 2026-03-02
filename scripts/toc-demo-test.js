/**
 * TOCペイン昇格テスト
 *
 * CDP（Chrome DevTools Protocol）経由で mdpad に接続し、
 * TOCペインが #pane-container 内の正式ペインとして正しく動作するかを検証する。
 *
 * テスト項目:
 * 1. TOCペインが #pane-container 内に存在すること
 * 2. ツールバーに TOC ボタンが存在すること
 * 3. togglePane("toc") で表示/非表示が切り替わること
 * 4. 見出し付きMDで見出しが正しく列挙されること
 * 5. 見出しクリックでエディタジャンプすること
 * 6. 「全表示」で4ペインすべて表示されること
 * 7. TOCボタンの active 状態が正しいこと
 * 8. cursor-active / viewport-visible クラスの確認
 *
 * @file toc-demo-test.js
 * @version 1.1.00066
 * @since 1.1.00064
 * @revision 1
 * @lastModified 2026-03-02 02:00:00 (JST)
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const CDP_PORT = 19223;

// テスト用Markdownコンテンツ（6レベルの見出し）
const TEST_MD = [
  "# Chapter 1",
  "Introduction text here.",
  "",
  "## Section 1.1",
  "Some content.",
  "",
  "### Subsection 1.1.1",
  "Details here.",
  "",
  "## Section 1.2",
  "More content.",
  "",
  "# Chapter 2",
  "Another chapter.",
  "",
  "## Section 2.1",
  "Final section.",
].join("\n");

/**
 * CDP 応答待ちキュー。
 * Node.js 22+ 組み込み WebSocket は .on("message") を使わず .onmessage を使う。
 * 複数の cdpSend を同時に発行できるよう、id ベースで管理する。
 * @type {Map<number, {resolve: Function, reject: Function}>}
 */
const pendingCdp = new Map();

/**
 * WebSocket に CDP onmessage ハンドラを設定する。
 * connectWs() 直後に1回だけ呼ぶ。
 *
 * @param {WebSocket} ws - 接続済み WebSocket
 */
function setupCdpMessageHandler(ws) {
  ws.onmessage = (event) => {
    const msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    if (msg.id !== undefined && pendingCdp.has(msg.id)) {
      const { resolve, reject } = pendingCdp.get(msg.id);
      pendingCdp.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
}

/**
 * CDP JSON メッセージ送受信。
 *
 * @param {WebSocket} ws - 接続済み WebSocket
 * @param {string} method - CDP メソッド名
 * @param {Object} params - パラメータ
 * @returns {Promise<Object>} CDP 応答
 */
function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    pendingCdp.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pendingCdp.has(id)) {
        pendingCdp.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 10000);
  });
}

/** CDP evaluate shorthand */
async function evaluate(ws, expression) {
  const result = await cdpSend(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS Error: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value;
}

/** CDP JSON エンドポイント取得 */
function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

/** WebSocket 接続（Node.js 22+ 組み込み WebSocket を使用） */
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error("WebSocket error"));
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

/** sleep */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("=== TOC Pane Promotion Test ===\n");

  // 1. mdpad を起動
  const exePath = path.join(__dirname, "..", "build30", "win-unpacked", "mdpad.exe");
  console.log("Launching mdpad...");
  const proc = spawn(exePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-sandbox",
  ], {
    stdio: "ignore",
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  // 起動待ち
  let ws = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    try {
      const targets = await getTargets();
      const page = targets.find((t) => t.type === "page" && t.url.includes("index.html"));
      if (page) {
        ws = await connectWs(page.webSocketDebuggerUrl);
        break;
      }
    } catch {
      // retry
    }
  }

  if (!ws) {
    console.error("FAIL: Could not connect to mdpad");
    proc.kill();
    process.exit(1);
  }

  console.log("Connected to mdpad via CDP\n");
  setupCdpMessageHandler(ws);
  await cdpSend(ws, "Runtime.enable");

  let pass = 0;
  let fail = 0;
  const total = 8;

  function ok(name, msg) {
    pass++;
    console.log(`  [PASS] ${name}: ${msg}`);
  }
  function ng(name, msg) {
    fail++;
    console.log(`  [FAIL] ${name}: ${msg}`);
  }

  try {
    // リカバリモーダルがあれば閉じる
    await sleep(2000);
    await evaluate(ws, `(() => {
      const overlay = document.getElementById("recovery-overlay");
      if (overlay) overlay.remove();
      const later = document.querySelector('[data-action="later"]');
      if (later) later.click();
    })()`);
    await sleep(500);

    // テスト 1: TOCペインが #pane-container 内に存在
    const tocInContainer = await evaluate(ws,
      `!!document.querySelector("#pane-container #toc-pane")`
    );
    tocInContainer
      ? ok("1. TOC in pane-container", "TOCペインが #pane-container 内に存在")
      : ng("1. TOC in pane-container", "TOCペインが見つからない");

    // テスト 2: ツールバーに TOC ボタンが存在
    const tocBtnExists = await evaluate(ws,
      `!!document.querySelector("#btn-toc")`
    );
    tocBtnExists
      ? ok("2. TOC toolbar button", "ツールバーに TOC ボタンが存在")
      : ng("2. TOC toolbar button", "TOC ボタンが見つからない");

    // テスト 3: togglePane("toc") で表示切替
    // まず TOC を表示
    await evaluate(ws, `window.__mdpadHandleMenuAction("toggleToc")`);
    await sleep(300);
    const tocVisible = await evaluate(ws,
      `document.getElementById("toc-pane").style.display`
    );
    // 非表示に戻す
    await evaluate(ws, `window.__mdpadHandleMenuAction("toggleToc")`);
    await sleep(300);
    const tocHidden = await evaluate(ws,
      `document.getElementById("toc-pane").style.display`
    );
    (tocVisible === "flex" && tocHidden === "none")
      ? ok("3. Toggle TOC", `表示=${tocVisible}, 非表示=${tocHidden}`)
      : ng("3. Toggle TOC", `表示=${tocVisible}, 非表示=${tocHidden}`);

    // テスト 4: 見出し付きMDで見出しが正しく列挙
    // コンテンツをセットしてからTOCを表示
    await evaluate(ws, `window.__mdpadSetAndSelect(${JSON.stringify(TEST_MD)}, 0, 0)`);
    await sleep(500);
    // TOCがまだ非表示の場合は表示する
    const tocState4 = await evaluate(ws,
      `document.getElementById("toc-pane").style.display`
    );
    if (tocState4 === "none") {
      await evaluate(ws, `window.__mdpadHandleMenuAction("toggleToc")`);
      await sleep(500);
    }
    // onEditorChange → updateToc は debounce 300ms。表示後にも再度呼ばれるのを待つ
    await sleep(1500);

    const headingCount = await evaluate(ws,
      `document.querySelectorAll("#toc-pane .toc-item").length`
    );
    (headingCount === 6)
      ? ok("4. Heading count", `6個の見出しを検出 (期待: 6)`)
      : ng("4. Heading count", `${headingCount}個の見出しを検出 (期待: 6)`);

    // テスト 5: 見出しクリックでエディタジャンプ
    await evaluate(ws, `document.querySelectorAll("#toc-pane .toc-item")[3].click()`);
    await sleep(300);
    const cursorLine = await evaluate(ws, `(() => {
      const editor = window.__mdpadEditor();
      if (!editor) return -1;
      const pos = editor.state.selection.main.head;
      return editor.state.doc.lineAt(pos).number;
    })()`);
    (cursorLine === 10)
      ? ok("5. Click jump", `カーソルが行${cursorLine}にジャンプ (期待: 10)`)
      : ng("5. Click jump", `カーソルが行${cursorLine}にジャンプ (期待: 10)`);

    // テスト 6: 「全表示」で4ペインすべて表示
    await evaluate(ws, `document.querySelector("#btn-all").click()`);
    await sleep(300);
    const allPanes = await evaluate(ws, `JSON.stringify({
      editor: document.getElementById("editor-pane").style.display,
      preview: document.getElementById("preview-pane").style.display,
      toc: document.getElementById("toc-pane").style.display,
      diff: document.getElementById("diff-pane").style.display,
    })`);
    const parsed = JSON.parse(allPanes);
    const allVisible = parsed.editor === "flex" && parsed.preview === "flex" &&
                       parsed.toc === "flex" && parsed.diff === "flex";
    allVisible
      ? ok("6. All panes", `4ペイン全表示: ${allPanes}`)
      : ng("6. All panes", `4ペイン全表示失敗: ${allPanes}`);

    // テスト 7: TOCボタンの active 状態
    const tocBtnActive = await evaluate(ws,
      `document.querySelector("#btn-toc").classList.contains("active")`
    );
    tocBtnActive
      ? ok("7. TOC button active", "TOCボタンが active 状態")
      : ng("7. TOC button active", "TOCボタンが active でない");

    // テスト 8: cursor-active クラスの確認
    // カーソルを先頭に移動してから少し待つ
    await evaluate(ws, `(() => {
      const editor = window.__mdpadEditor();
      if (editor) {
        editor.dispatch({ selection: { anchor: 0 } });
        editor.focus();
      }
    })()`);
    await sleep(500); // setInterval(200ms) の更新を待つ

    const cursorActiveExists = await evaluate(ws,
      `document.querySelectorAll("#toc-pane .toc-item.cursor-active").length`
    );
    (cursorActiveExists >= 1)
      ? ok("8. cursor-active", `cursor-active クラスの見出しが ${cursorActiveExists} 個存在`)
      : ng("8. cursor-active", "cursor-active クラスの見出しが見つからない");

  } catch (err) {
    console.error("Test error:", err.message);
    fail++;
  }

  // 結果
  console.log(`\n${"=".repeat(50)}`);
  if (fail === 0) {
    console.log(`TOC PANE TEST PASSED (${pass}/${total})`);
  } else {
    console.log(`TOC PANE TEST: ${pass} PASS, ${fail} FAIL (total ${total})`);
  }
  console.log("=".repeat(50));

  // クリーンアップ
  ws.close();
  proc.kill();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
