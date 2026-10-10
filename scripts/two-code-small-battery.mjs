import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { runEdgeCases } from "./two-code-edge-cases.mjs";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/qa/small-battery-${Date.now()}`;
const workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
const preferences = {
  dual: true,
  mode: "build",
  lead: { harness: "pi", provider: "bigmodel-coding-plan", model: "glm-5.3", thinking: "max" },
  sidekick: { harness: "pi", provider: "ds-tencent", model: "claude-sonnet-4-8", thinking: "high" },
};
await fs.writeFile(path.join(root, "data/preferences.json"), JSON.stringify(preferences));
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: path.join(root, "data"),
  ZCODE_DATA_BASE_DIR: path.join(root, "data"),
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const executable =
  process.env.TWO_CODE_QA_EXE ||
  (process.env.TWO_CODE_QA_SOURCE === "1"
    ? path.join(repo, "node_modules/electron/dist/electron.exe")
    : "D:/Apps/TwoCode/releases/0.7.5/win-unpacked/Two Code.exe");
const app = await electron.launch({
  executablePath: executable,
  args: [
    ...(process.env.TWO_CODE_QA_SOURCE === "1" ? [path.join(repo, "packages/desktop")] : []),
    "--disable-gpu",
  ],
  env,
  timeout: 60000,
});
const results = [],
  errors = [];
let page, first;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async (id) =>
  JSON.parse(await fs.readFile(path.join(root, `data/tasks/${id}.json`), "utf8"));
async function tasks() {
  try {
    return await Promise.all(
      (await fs.readdir(path.join(root, "data/tasks")))
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await fs.readFile(path.join(root, "data/tasks", f), "utf8"))),
    );
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function until(predicate, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`condition timed out after ${timeout}ms`);
}
async function send(text, id) {
  const previous = new Set((await tasks()).map((t) => t.id));
  await page.getByTestId("two-code-composer").fill(text);
  await page.getByTestId("two-code-send").click();
  return until(async () => {
    const task = id ? await read(id) : (await tasks()).find((t) => !previous.has(t.id));
    return task?.events.some((e) => e.role === "user" && e.text === text) && task;
  }, 20000);
}
async function fresh() {
  await page
    .getByRole("button", { name: /^新建任务/ })
    .first()
    .click();
  await page.getByTestId("two-code-star-sea").waitFor();
}
async function completed(id, allowFile, reloadPermission = false) {
  let approvals = 0,
    denials = 0,
    reloaded = false;
  const result = await until(async () => {
    const task = await read(id);
    const dialog = page.getByTestId("two-code-permission");
    // 权限等待属于Host内存态；必须观测实际UI，不能把任务落盘快照当成实时RPC状态。
    if (await dialog.isVisible()) {
      if (reloadPermission && !reloaded) {
        await page.reload();
        await dialog.waitFor({ state: "visible", timeout: 15000 });
        reloaded = true;
      }
      const tool = (await dialog.getAttribute("data-tool")).toLowerCase();
      const raw = (await dialog.innerText()).match(/\{[\s\S]*?\}/)?.[0];
      const args = raw ? JSON.parse(raw) : {};
      const allow =
        !!allowFile &&
        ["write", "edit"].includes(tool) &&
        typeof (args.path || args.file_path) === "string" &&
        path.resolve(task.workspacePath, args.path || args.file_path) ===
          path.resolve(workspace, allowFile);
      await page.screenshot({ animations: "disabled", path: path.join(root, "permission.png") });
      await dialog.getByRole("option", { name: allow ? "允许本次" : "拒绝", exact: true }).focus();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      if (allow) approvals++;
      else denials++;
      assert(denials <= 3, "model kept retrying a denied tool");
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
    }
    return task.status !== "running" && task;
  });
  assert.equal(result.status, "completed", result.error);
  return { ...result, approvals, denials, reloaded };
}
async function checkCase(name, work) {
  if (process.env.TWO_CODE_CASES && !process.env.TWO_CODE_CASES.split(",").includes(name)) return;
  const start = Date.now();
  try {
    await work();
    results.push({ name, passed: true, ms: Date.now() - start });
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error.message,
      stack: error.stack,
      ms: Date.now() - start,
    });
    await page
      .screenshot({ animations: "disabled", path: path.join(root, `${name}-failure.png`) })
      .catch(() => {});
    await fs.writeFile(
      path.join(root, `${name}-failure.txt`),
      (await page.locator("body").innerText()).slice(-18000),
    );
    const stop = page.getByTestId("two-code-stop");
    if (await stop.isVisible()) {
      await stop.click();
      await sleep(500);
    }
  }
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, results, errors }, null, 2),
  );
  console.log(JSON.stringify(results.at(-1)));
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw new Error("background isolation failed");
    w.showInactive();
  });
  console.log(JSON.stringify({ root, executable }));
  await checkCase("selection", async () => {
    for (const [role, expected] of [
      ["lead", ["低", "高", "最高"]],
      ["sidekick", ["关闭", "低", "高", "最高"]],
    ]) {
      const label = role === "lead" ? "主手" : "副手";
      await page.getByTestId(`two-code-${role}-model`).click();
      const panel = page.getByTestId(`two-code-${role}-panel`);
      await panel.getByRole("combobox", { name: `${label}思考档位` }).click();
      assert.deepEqual(
        await page.getByRole("listbox").last().getByRole("option").allTextContents(),
        expected,
      );
      await page
        .getByRole("option", { name: role === "lead" ? "最高" : "高", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
  });
  await checkCase("delegation", async () => {
    const task = await send(
      "小任务：只调用一次sidekick，让副手记住暗号松涛，并计算19乘23。主手核对后只输出乘积。不要使用其他工具或文件。",
    );
    first = await completed(task.id);
    assert.match(first.lead.lastReport, /437/);
    assert.equal(first.sidekick.status, "completed");
    assert.match(first.sidekick.lastReport, /437/);
    const childRecords = (await fs.readFile(first.sidekick.sessionId, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const childPrompt = childRecords
      .find((record) => record.message?.role === "user")
      ?.message.content.map((part) => part.text ?? "")
      .join("");
    assert.match(childPrompt ?? "", /本轮用户原始请求/);
    assert.match(childPrompt ?? "", /不要使用其他工具或文件/);
    assert.equal(first.lead.selection.thinking, "max");
    assert.equal(first.sidekick.selection.thinking, "high");
    assert(first.usage.some((u) => u.role === "lead" && u.outputTokens > 0));
    assert(first.usage.some((u) => u.role === "sidekick" && u.outputTokens > 0));
    await page.getByText("437", { exact: true }).last().waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(root, "delegation.png") });
  });
  await checkCase("history", async () => {
    assert(first, "delegation prerequisite failed");
    const before = JSON.stringify(first.usage);
    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    assert.equal(JSON.stringify((await read(first.id)).usage), before, "reload duplicated usage");
    await send(
      "继续，只调用sidekick询问它上轮收到的暗号，以及把上轮乘积加1。不要提示它暗号或上轮答案。主手最后输出暗号与新数字，不使用其他工具。",
      first.id,
    );
    const next = await completed(first.id);
    assert.match(next.lead.lastReport, /松涛/);
    assert.match(next.lead.lastReport, /438/);
    assert.equal(next.lead.sessionId, first.lead.sessionId);
    assert.equal(next.sidekick.sessionId, first.sidekick.sessionId);
    assert(next.usage.length > first.usage.length);
  });
  await checkCase("permission", async () => {
    await fresh();
    const task = await send(
      "小任务：派副手用write创建当前工作目录中的dual-proof.txt，内容必须恰为PAIR_OK。写入完成后主手用read读取核对，只回复PAIR_OK。只允许这个文件的write/read和sidekick/read_sidekick，禁止shell、联网及其他工具。",
    );
    const result = await completed(task.id, "dual-proof.txt");
    assert(result.approvals >= 1, "no permission surfaced");
    assert.equal(await fs.readFile(path.join(workspace, "dual-proof.txt"), "utf8"), "PAIR_OK");
    assert.equal(result.sidekick.status, "completed");
    assert.match(result.lead.lastReport, /PAIR_OK/);
  });
  await checkCase("cancel", async () => {
    await fresh();
    const task = await send(
      "派副手逐步计算从1到120的平方和，主手等待报告后核对。不要使用其他工具。",
    );
    await until(async () => {
      const t = await read(task.id);
      if (t.status === "error") throw new Error(t.error);
      return t.sidekick.status === "running";
    }, 60000);
    await page.getByTestId("two-code-stop").click();
    await page
      .locator('[data-testid="two-code-state"][data-status="cancelled"]')
      .waitFor({ timeout: 20000 });
    await sleep(1500);
    assert.equal(
      (await read(task.id)).status,
      "cancelled",
      "late completion overwrote cancellation",
    );
    await page.screenshot({ animations: "disabled", path: path.join(root, "cancelled.png") });
    assert.equal(
      await page
        .getByRole("alert")
        .filter({ hasText: /任务已停止/ })
        .count(),
      0,
      "normal stop rendered as an error alert",
    );
    await send("停止上一题。现在不派工、不使用任何工具，只回复RESUMED_OK。", task.id);
    assert.match((await completed(task.id)).lead.lastReport, /RESUMED_OK/);
    const stoppedTool = page.locator('[data-tool-name="sidekick"]').first();
    await stoppedTool.waitFor();
    assert.equal(
      await stoppedTool.getAttribute("data-status"),
      "stopped",
      "historical tool returned to running after resume",
    );
    await page.getByText("已停止", { exact: true }).first().waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(root, "cancel-resumed.png") });
  });
  await checkCase("parallel", async () => {
    await fresh();
    await page.getByTestId("chat-mode-select-trigger").click();
    await page.getByRole("option", { name: /计划模式/ }).click();
    const a = await send("并行隔离A：派副手计算7乘11，主手最后只回复A=77。不要使用其他工具。");
    await fresh();
    const b = await send("并行隔离B：派副手计算8乘13，主手最后只回复B=104。不要使用其他工具。");
    const [ra, rb] = await Promise.all([completed(a.id), completed(b.id)]);
    assert.match(ra.lead.lastReport, /A\s*=\s*77/);
    assert.match(rb.lead.lastReport, /B\s*=\s*104/);
    assert.notEqual(ra.sidekick.sessionId, rb.sidekick.sessionId);
    await page.locator(`[data-testid*="task-item"][data-testid$="${a.id}"]`).click();
    await page
      .getByText(/A\s*=\s*77/)
      .last()
      .waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(root, "parallel.png") });
  });
  await checkCase("permission-refresh", async () => {
    await fresh();
    await page.getByTestId("chat-mode-select-trigger").click();
    await page.getByRole("option", { name: /变更前确认/ }).click();
    const task = await send(
      "派副手用write创建当前目录reload-proof.txt，内容恰为RELOAD_OK。等待批准，成功后主手只报告RELOAD_OK。只能调用sidekick与write，不使用其他工具。",
    );
    const result = await completed(task.id, "reload-proof.txt", true);
    assert(result.reloaded, "no waiting permission to reload");
    assert.equal(await fs.readFile(path.join(workspace, "reload-proof.txt"), "utf8"), "RELOAD_OK");
  });
  await checkCase("nonblocking", async () => {
    await fresh();
    const task = await send(
      "小任务：严格按顺序调用sidekick，参数block=false，让副手只心算9+8；主手随后先说一句主手处理中；然后必须调用read_sidekick读取报告，核对后只回复17。不要使用其他工具。",
    );
    const result = await completed(task.id);
    assert.equal(result.sidekick.status, "completed");
    assert.match(result.lead.lastReport, /17/);
    assert(
      result.events.some(
        (event) => event.role === "lead" && event.kind === "tool" && event.text === "read_sidekick",
      ),
    );
    const records = (await fs.readFile(result.lead.sessionId, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const calls = records
      .flatMap((record) => record.message?.content ?? [])
      .filter((part) => part.type === "toolCall");
    assert(calls.some((call) => call.name === "sidekick" && call.arguments.block === false));
  });
  await checkCase("denial", async () => {
    await fresh();
    const task = await send(
      "权限拒绝小任务：副手只尝试一次write创建denied-proof.txt，内容DENIED。若被用户拒绝，禁止重试和任何替代工具，副手报告已拒绝，主手确认后结束。只允许sidekick和这一次write。",
    );
    const result = await completed(task.id);
    assert.equal(result.denials, 1);
    await assert.rejects(fs.access(path.join(workspace, "denied-proof.txt")));
    assert.match(result.lead.lastReport, /拒绝/);
  });
  await checkCase("drafts", async () => {
    const existing = (await tasks()).find((t) => t.status === "completed");
    assert(existing);
    const row = page.locator(`[data-testid*="task-item"][data-testid$="${existing.id}"]`);
    await row.click();
    await page.getByTestId("two-code-composer").fill("未发送草稿甲");
    await fresh();
    await page.getByTestId("two-code-composer").fill("未发送草稿乙");
    await row.click();
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      "未发送草稿甲",
      "return to saved task draft",
    );
    await fresh();
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      "未发送草稿乙",
      "return to unsent draft",
    );
    await page.reload();
    await page.getByTestId("two-code-composer").waitFor();
    await until(
      async () => (await page.getByTestId("two-code-composer").innerText()) === "未发送草稿乙",
      5000,
    );
    assert.equal(
      await page.getByTestId("two-code-composer").innerText(),
      "未发送草稿乙",
      "reload unsent draft",
    );
  });
  await runEdgeCases({
    page,
    root,
    workspace,
    tasks,
    read,
    send,
    fresh,
    completed,
    until,
    checkCase,
  });
  if (errors.length) results.push({ name: "renderer", passed: false, errors });
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, results, errors }, null, 2),
  );
  console.log(JSON.stringify({ finished: true, root, passed: results.every((r) => r.passed) }));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await app.close();
}
