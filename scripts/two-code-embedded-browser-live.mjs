import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
const root = `D:/Apps/TwoCode/qa/embedded-browser-${Date.now()}`;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-embedded-browser-qa", root }),
);
const saved = [],
  inputValues = [];
const server = createServer(async (req, res) => {
  if (req.url === "/input" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    inputValues.push(JSON.parse(body).value);
    res.writeHead(204).end();
    return;
  }
  if (req.url === "/save" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { note } = JSON.parse(body);
    saved.push(note);
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ note, count: saved.length }));
    return;
  }
  if (req.url !== "/") {
    res.writeHead(404).end();
    return;
  }
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(
      `<!doctype html><html><head><title>Two Code 内置浏览器验收</title></head><body style="font:24px Arial;padding:30px;background:#f1f5f9"><h1>协作便签</h1><p>只在当前测试页保存备注。</p><label>备注 <input id="note" value="旧内容" aria-label="备注" style="font:24px Arial"></label><button id="save" style="font:24px Arial">保存备注</button><p id="result" role="status">尚未保存</p><canvas id="visual" width="320" height="140"></canvas><script>document.querySelector('#note').oninput=e=>fetch('/input',{method:'POST',body:JSON.stringify({value:e.target.value})});const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#2563eb';c.fillRect(0,0,320,140);c.fillStyle='white';c.font='bold 56px Arial';c.fillText('6372',75,90);document.querySelector('#save').onclick=async()=>{const note=document.querySelector('#note').value;const result=await fetch('/save',{method:'POST',body:JSON.stringify({note})}).then(r=>r.json());document.querySelector('#result').textContent='已保存：'+result.note+'；次数：'+result.count;};</script></body></html>`,
    );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "edit",
    lead: {
      harness: "step-code",
      provider: "step-plan",
      model: "step-5-preview",
      thinking: "medium",
    },
    sidekick: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: `${root}/data`,
  ZCODE_DATA_BASE_DIR: `${root}/data`,
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.22"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
let page;
const permissions = [],
  results = [],
  errors = [],
  surfaceSamples = [];
async function read() {
  const files = (await fs.readdir(`${root}/data/tasks`).catch(() => [])).filter((n) =>
    n.endsWith(".json"),
  );
  return Promise.all(
    files.map(async (n) => JSON.parse(await fs.readFile(`${root}/data/tasks/${n}`, "utf8"))),
  );
}
async function nativeBrowserEvidence(task, role) {
  const file =
    role === "lead"
      ? task.lead.sessionId
      : path.join(
          homedir(),
          ".claude/projects",
          task.workspacePath.replace(/[^a-zA-Z0-9]/g, "-"),
          `${task.sidekick.sessionId}.jsonl`,
        );
  const rows = (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const calls = new Map(),
    evidence = [];
  for (const row of rows) {
    const message = row.message;
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (
        (block.type === "toolCall" || block.type === "tool_use") &&
        /^(browser|mcp__two_code__browser)$/.test(block.name)
      ) {
        try {
          calls.set(block.id, JSON.parse((block.arguments ?? block.input).request));
        } catch {}
      }
      if (block.type === "tool_result" && calls.has(block.tool_use_id))
        evidence.push({
          role,
          request: calls.get(block.tool_use_id),
          success: !block.is_error,
          hasPixels: Array.isArray(block.content) && block.content.some((c) => c.type === "image"),
        });
    }
    if (message.role === "toolResult" && calls.has(message.toolCallId))
      evidence.push({
        role,
        request: calls.get(message.toolCallId),
        success: !message.isError,
        hasPixels: message.content.some((c) => c.type === "image"),
      });
  }
  return evidence;
}
async function settle(previousCount = 0, taskId) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const surfaces = await page.evaluate(() =>
      [...document.querySelectorAll('[data-browser-screenshot-surface-state="preparing"]')].map(
        (node) => {
          const w = node.querySelector("webview");
          return {
            state: node.getAttribute("data-browser-screenshot-surface-state"),
            webview: w
              ? {
                  width: w.offsetWidth,
                  height: w.offsetHeight,
                  rect: w.getBoundingClientRect().toJSON(),
                  layoutScale: w.dataset.browserLayoutScale,
                }
              : null,
          };
        },
      ),
    );
    if (surfaces.length && surfaceSamples.length < 300)
      surfaceSamples.push({ at: Date.now(), surfaces });
    const tasks = await read();
    const task = taskId
      ? tasks.find((t) => t.id === taskId)
      : tasks.find((t) => t.events.length > previousCount);
    if (task) {
      // 权限请求属于当前运行态，不保证落盘；必须从实际前端卡片裁决，不能等磁盘字段。
      const dialog = page.getByTestId("two-code-permission");
      if (await dialog.isVisible()) {
        const tool = await dialog.getAttribute("data-tool");
        const body = (await dialog.innerText()).replaceAll('\\"', '"');
        const method = body.match(/"method"\s*:\s*"([a-zA-Z]+)"/)?.[1];
        const allow =
          tool === "browser" &&
          ([
            "click",
            "fill",
            "type",
            "press",
            "scroll",
            "hover",
            "select",
            "check",
            "close",
            "newTab",
            "back",
            "forward",
            "reload",
          ].includes(method) ||
            (method === "navigate" && body.includes(url)));
        permissions.push({ tool, method, allow, body });
        await dialog
          .getByRole("option", { name: allow ? "允许本次" : "拒绝", exact: true })
          .focus();
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 15000 });
      }
      if (task.status !== "running" && task.events.length > previousCount) return task;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("内置浏览器真实任务300秒截止");
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByTestId("two-code-lead-model")
    .getByText("Step-5 订阅", { exact: true })
    .waitFor({ timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("非隔离窗口");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  console.log(JSON.stringify({ root, url }));
  let last, sessions;
  const nativeCounts = { lead: 0, sidekick: 0 };
  for (const [index, note] of ["第一轮4826", "续接7823"].entries()) {
    const before = last?.events.at(-1)?.seq ?? 0;
    const inputStart = inputValues.length;
    const text =
      index === 0
        ? `真实内置浏览器验收：只能用browser和sidekick/read_sidekick工具，禁止shell、外部Chrome、Playwright和读写文件。主手用browser打开${url}并snapshot，随后把同一标签页交给唯一副手，副手实际填备注“${note}”并点击一次“保存备注”，snapshot核对保存值，然后screenshot看蓝色画布里的四位数字并简短报告。主手再用browser查看同一页的DOM和截图，核对备注与数字。不要猜ref；每次按snapshot返回的ref操作，不要重复点击。最后一句报告保存值、保存次数和截图数字。`
        : `继续上轮同一内置浏览器标签页，不重新navigate、不重新开页。主手snapshot确认旧备注，交同一副手把备注改成“${note}”并且只点一次保存，双方分别snapshot复核，主手screenshot复核画布数字。仍只用browser和交接工具，不运行命令。最后一句报告保存值、保存次数和画布数字。`;
    const started = Date.now();
    await page
      .getByTestId("two-code-composer")
      .fill(
        text +
          ' 本轮请副手先用fill(value="")清空输入并snapshot确认，再用fill(value=目标备注)填充；仅在两次fill都成功后点击保存。不用type/press或evaluate绕过fill失败，遇错报告真实错误。',
      );
    await page.getByTestId("two-code-send").click();
    last = await settle(before, last?.id);
    await fs.writeFile(`${root}/round-${index + 1}.json`, JSON.stringify(last, null, 2));
    assert.equal(last.status, "completed", last.error);
    assert.deepEqual(saved, index === 0 ? ["第一轮4826"] : ["第一轮4826", "续接7823"]);
    assert.deepEqual(
      inputValues.slice(inputStart),
      ["", note],
      "页面实际输入事件必须是清空再填入新值，不能仅相信工具ok",
    );
    for (const role of ["lead", "sidekick"])
      assert(
        last.events.some(
          (e) => e.seq > before && e.role === role && e.kind === "tool" && /browser/.test(e.text),
        ),
        `${role}没有实际调用内置浏览器`,
      );
    assert.match(last.lead.lastReport, /6372/);
    assert(last.lead.lastReport.includes(note));
    const browserEvidence = [
      ...(await nativeBrowserEvidence(last, "lead")),
      ...(await nativeBrowserEvidence(last, "sidekick")),
    ];
    const currentEvidence = Object.entries(nativeCounts).flatMap(([role, count]) => {
      const rows = browserEvidence.filter((e) => e.role === role);
      nativeCounts[role] = rows.length;
      return rows.slice(count);
    });
    assert.equal(
      currentEvidence.filter(
        (e) => e.role === "sidekick" && e.request.method === "click" && e.success,
      ).length,
      1,
      "保存必须由副手且只执行一次",
    );
    assert.equal(
      currentEvidence.filter((e) => e.role === "lead" && e.request.method === "click" && e.success)
        .length,
      0,
      "主手不得替副手执行保存",
    );
    if (index > 0)
      assert(
        !currentEvidence.some(
          (e) => ["navigate", "newTab", "reload"].includes(e.request.method) && e.success,
        ),
        "续接不得重新开页或导航",
      );
    assert(
      browserEvidence.some(
        (e) =>
          e.role === "sidekick" &&
          e.request.method === "fill" &&
          e.request.value === "" &&
          e.success,
      ),
      "缺少原生清空回执",
    );
    assert(
      browserEvidence.some(
        (e) =>
          e.role === "sidekick" &&
          e.request.method === "fill" &&
          e.request.value === note &&
          e.success,
      ),
      "缺少原生填充回执",
    );
    if (index === 0)
      for (const role of ["lead", "sidekick"])
        assert(
          browserEvidence.some(
            (e) => e.role === role && e.request.method === "screenshot" && e.success && e.hasPixels,
          ),
          `${role}缺少成功返回像素的原生截图回执`,
        );
    await fs.writeFile(
      `${root}/native-browser-evidence.json`,
      JSON.stringify(browserEvidence, null, 2),
    );
    if (index === 0) {
      assert.match(last.sidekick.lastReport, /6372/);
      sessions = { lead: last.lead.sessionId, sidekick: last.sidekick.sessionId };
    } else {
      assert.equal(last.lead.sessionId, sessions.lead);
      assert.equal(last.sidekick.sessionId, sessions.sidekick);
    }
    const guests = await app.evaluate(
      ({ webContents }, target) =>
        webContents
          .getAllWebContents()
          .filter((w) => w.getURL() === target)
          .map((w) => ({ id: w.id, type: w.getType(), url: w.getURL() })),
      url,
    );
    assert.equal(guests.length, 1, "应该只有一个真正Electron内置页面");
    assert.notEqual(guests[0].type, "browser");
    await page.screenshot({ path: `${root}/round-${index + 1}.png` });
    results.push({
      round: index + 1,
      passed: true,
      elapsedMs: Date.now() - started,
      taskId: last.id,
      guest: guests[0],
      saved: [...saved],
      report: last.lead.lastReport,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ passed: false, error: String(error) });
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png` }).catch(() => {});
} finally {
  if (
    page &&
    (await page
      .getByTestId("two-code-stop")
      .isVisible()
      .catch(() => false))
  )
    await page.getByTestId("two-code-stop").click();
  // app.close结束本验收Host及其子进程，不碰桌面正在使用的实例。
  await app.close();
  await new Promise((r) => server.close(r));
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify({ results, errors, saved, inputValues, permissions, surfaceSamples }, null, 2),
  );
  await fs.writeFile(`${root}/closed.json`, JSON.stringify({ at: new Date().toISOString() }));
  console.log(JSON.stringify({ root, results, errors, saved }));
}
