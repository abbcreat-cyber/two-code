import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const root = `D:/Apps/TwoCode/qa/embedded-browser-${Date.now()}`;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-embedded-browser-qa", root }),
);
const values = { a: "A保持原状", b: "B初始" },
  writes = [],
  loads = [],
  inputs = [],
  results = [],
  permissions = [],
  errors = [];
const server = createServer(async (req, res) => {
  const page = req.url?.split("/")[1];
  if (!["a", "b"].includes(page)) {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { value } = JSON.parse(raw);
    if (req.url.endsWith("/input")) inputs.push({ page, value });
    else {
      values[page] = value;
      writes.push({ page, value });
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        value: values[page],
        count: writes.filter((w) => w.page === page).length,
      }),
    );
    return;
  }
  loads.push(page);
  const count = writes.filter((w) => w.page === page).length;
  res
    .writeHead(200, { "content-type": "text/html;charset=utf-8" })
    .end(
      `<!doctype html><title>页面 ${page.toUpperCase()}</title><body style="font:24px Arial;padding:25px"><h1>页面 ${page.toUpperCase()}</h1><label>备注<input id="note" value="${values[page]}" aria-label="备注"></label><button id="save">保存</button><p role="status" id="status">保存次数：${count}；当前值：${values[page]}</p><script>note.oninput=e=>fetch('/${page}/input',{method:'POST',body:JSON.stringify({value:e.target.value})});save.onclick=async()=>{const r=await fetch('/${page}/save',{method:'POST',body:JSON.stringify({value:note.value})}).then(r=>r.json());document.querySelector('#status').textContent='保存次数：'+r.count+'；当前值：'+r.value;};</script>`,
    );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
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
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.23"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
let page;
const snapshots = [];
async function tasks() {
  return Promise.all(
    (await fs.readdir(`${root}/data/tasks`).catch(() => []))
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => JSON.parse(await fs.readFile(`${root}/data/tasks/${f}`, "utf8"))),
  );
}
async function evidence(task, role) {
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
      .map((s) => JSON.parse(s)),
    calls = new Map(),
    out = [];
  function add(id, content, failed) {
    if (!calls.has(id)) return;
    let result;
    for (const item of typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : []) {
      if (item.type === "text")
        try {
          const parsed = JSON.parse(item.text);
          if (typeof parsed.ok === "boolean") {
            result = parsed;
            break;
          }
        } catch {}
    }
    out.push({ role, request: calls.get(id), success: !failed, result });
  }
  for (const row of rows) {
    const message = row.message;
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (
        ["toolCall", "tool_use"].includes(block.type) &&
        /^(browser|mcp__two_code__browser)$/.test(block.name)
      )
        try {
          const request = (block.arguments ?? block.input).request;
          calls.set(block.id, typeof request === "string" ? JSON.parse(request) : request);
        } catch {}
      if (block.type === "tool_result") add(block.tool_use_id, block.content, block.is_error);
    }
    if (message.role === "toolResult") add(message.toolCallId, message.content, message.isError);
  }
  return out;
}
async function allEvidence(task) {
  return [...(await evidence(task, "lead")), ...(await evidence(task, "sidekick"))];
}
async function settle(text, prior, id) {
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const dialog = page.getByTestId("two-code-permission");
    if (await dialog.isVisible()) {
      const tool = await dialog.getAttribute("data-tool"),
        body = (await dialog.innerText()).replaceAll('\\"', '"');
      const method = body.match(/"method"\s*:\s*"([a-zA-Z]+)"/)?.[1];
      const allow =
        tool === "browser" &&
        (["newTab", "fill", "click", "reload", "close"].includes(method) ||
          (method === "navigate" &&
            (body.includes(`${origin}/a`) || body.includes(`${origin}/b`))));
      permissions.push({ tool, method, allow });
      await dialog.getByRole("option", { name: allow ? "允许本次" : "拒绝", exact: true }).focus();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
    }
    const current = (await tasks()).find((t) => (id ? t.id === id : !prior.has(t.id)));
    if (
      current &&
      current.events.some((e) => e.role === "user" && e.text === text) &&
      current.status !== "running"
    )
      return current;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("本轮300秒截止");
}
async function run(name, text, id) {
  const prior = new Set((await tasks()).map((t) => t.id)),
    started = Date.now();
  const prompt =
    text +
    " 全程只用内置browser与sidekick/read_sidekick，禁止shell、外部浏览器、源码读写和evaluate；实际结果与预期不同须如实报告。主手判断和复核，动作由指定角色执行，别重复保存。";
  await page.getByTestId("two-code-composer").fill(prompt);
  await page.getByTestId("two-code-send").click();
  const task = await settle(prompt, prior, id);
  snapshots.push(task);
  await fs.writeFile(`${root}/${name}.json`, JSON.stringify(task, null, 2));
  assert.equal(task.status, "completed", task.error);
  const native = await allEvidence(task);
  await fs.writeFile(`${root}/${name}-native.json`, JSON.stringify(native, null, 2));
  console.log(
    JSON.stringify({
      name,
      elapsedMs: Date.now() - started,
      status: task.status,
      report: task.lead.lastReport,
    }),
  );
  return { task, native, elapsedMs: Date.now() - started };
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
  console.log(JSON.stringify({ root, origin }));
  const first = await run(
    "tabs",
    `多标签协作验收：主手用browser打开${origin}/a，snapshot记录A值并记录返回的tabId。交唯一副手调用newTab新开B（不能在A原标签导航），用返回的B tabId打开${origin}/b，snapshot取ref，fill备注“B副手已保存”并保存一次。主手最后带各自tabId分别snapshot A/B并list，确认两个标签都还在、A仍为“A保持原状”、B已保存。报告真实A/B tabId和结果。`,
  );
  assert.deepEqual(writes, [{ page: "b", value: "B副手已保存" }]);
  assert(
    first.native
      .filter((e) => e.request.method === "navigate" && e.result?.ok)
      .every((e) => e.result.state?.url && e.result.state.url !== "about:blank"),
    "navigate不得把空白页作为成功返回",
  );
  assert(
    inputs.every((i) => i.page === "b"),
    "A页不得被输入操作修改",
  );
  assert.equal(values.a, "A保持原状");
  const listing = first.native
    .filter((e) => e.role === "lead" && e.request.method === "list" && e.result?.ok)
    .at(-1)?.result.tabs;
  assert.equal(listing?.length, 2, "必须有两个本任务标签");
  const tabA = listing.find((t) => t.url === `${origin}/a` || t.url === `${origin}/a/`),
    tabB = listing.find((t) => t.url === `${origin}/b` || t.url === `${origin}/b/`);
  assert(tabA && tabB && tabA.tabId !== tabB.tabId);
  assert(
    first.native.some(
      (e) => e.role === "sidekick" && e.request.method === "newTab" && e.result?.ok,
    ),
  );
  const actorSessions = [first.task.lead.sessionId, first.task.sidekick.sessionId];
  results.push({ name: "tabs", passed: true, elapsedMs: first.elapsedMs, tabA, tabB });
  const beforeLoads = loads.filter((p) => p === "b").length;
  const next = await run(
    "recovery",
    `继续同一任务：A=${tabA.tabId}，B=${tabB.tabId}。唯一副手先reload B并snapshot，核对刷新后仍为“B副手已保存”。随后做一次明确的负向测试：向B发送fill ref="qa-ref-missing" value="不应写入"，预期ref_not_found，不能改任何真实字段。收到预期错误后重新snapshot取得真实ref，fill为“B刷新后续接”并保存一次。主手最后分别snapshot A/B，A不得变化。不要新开标签、不要用navigate冒充reload。`,
    first.task.id,
  );
  assert.deepEqual([next.task.lead.sessionId, next.task.sidekick.sessionId], actorSessions);
  assert(loads.filter((p) => p === "b").length > beforeLoads);
  assert(
    next.native.some(
      (e) =>
        e.role === "sidekick" &&
        e.request.method === "reload" &&
        e.request.tabId === tabB.tabId &&
        e.result?.ok,
    ),
  );
  assert(inputs.every((i) => i.page === "b"));
  assert.deepEqual(writes, [
    { page: "b", value: "B副手已保存" },
    { page: "b", value: "B刷新后续接" },
  ]);
  assert(!inputs.some((i) => i.value === "不应写入"));
  assert(
    next.native.some(
      (e) => e.request.ref === "qa-ref-missing" && e.result?.error?.code === "ref_not_found",
    ),
  );
  results.push({ name: "recovery", passed: true, elapsedMs: next.elapsedMs });
  await page
    .getByRole("button", { name: /^新建任务/ })
    .first()
    .click();
  const isolated = await run(
    "isolation",
    `独立任务隔离验收：主手先browser list，本新任务应当没有受控标签。交唯一副手也list，并用browser getState tabId="${tabB.tabId}"做一次跨任务负向测试：此ID来自另一个测试任务，必须拒绝而不是读取页面内容。此动作仅测试拒绝，绝不认领、关闭或修改其他任务页。副手再list、主手最后list，都应仍为空。不要打开新页，不需要截图。报告真实错误代码和当前标签数量。`,
  );
  for (const role of ["lead", "sidekick"]) {
    const lists = isolated.native.filter(
      (e) => e.role === role && e.request.method === "list" && e.result,
    );
    assert(lists.length > 0);
    assert(lists.every((e) => e.result?.ok && e.result.tabs?.length === 0));
  }
  assert(
    isolated.native.some(
      (e) => e.role === "sidekick" && e.request.tabId === tabB.tabId && e.result?.ok === false,
    ),
  );
  assert.deepEqual(writes, [
    { page: "b", value: "B副手已保存" },
    { page: "b", value: "B刷新后续接" },
  ]);
  results.push({ name: "isolation", passed: true, elapsedMs: isolated.elapsedMs });
  await page
    .locator("[data-task-item-key], [data-grouped-task-key]")
    .filter({ hasText: "多标签协作验收" })
    .first()
    .click();
  const closed = await run(
    "close",
    `回到原任务。让同一副手只关闭B（browser close tabId="${tabB.tabId}"），必须保留A=${tabA.tabId}。副手list、主手list都应只剩A；主手snapshot A确认“A保持原状”。不新建标签、不修改内容。`,
    first.task.id,
  );
  assert.deepEqual([closed.task.lead.sessionId, closed.task.sidekick.sessionId], actorSessions);
  const finalList = closed.native
    .filter((e) => e.role === "lead" && e.request.method === "list" && e.result?.ok)
    .at(-1)?.result.tabs;
  assert.deepEqual(
    finalList?.map((t) => t.tabId),
    [tabA.tabId],
  );
  const guestUrls = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((w) => w.getType() === "webview")
      .map((w) => w.getURL()),
  );
  assert(guestUrls.includes(`${origin}/a`));
  assert(!guestUrls.includes(`${origin}/b`));
  results.push({ name: "close", passed: true, elapsedMs: closed.elapsedMs });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${root}/finished.png` });
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
  await app.close();
  await new Promise((r) => server.close(r));
  await fs.writeFile(`${root}/closed.json`, JSON.stringify({ at: new Date().toISOString() }));
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify({ results, writes, inputs, loads, permissions, errors }, null, 2),
  );
  await fs.writeFile(
    `${root}/native-browser-evidence.json`,
    JSON.stringify(
      await Promise.all(
        [...new Map(snapshots.map((task) => [task.id, task])).values()].map(async (task) => ({
          taskId: task.id,
          evidence: await allEvidence(task),
        })),
      ),
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ root, results, writes, errors }));
}
