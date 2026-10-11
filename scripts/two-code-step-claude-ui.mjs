import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const replay = process.env.TWO_CODE_QA_REPLAY_ROOT;
const root = replay || `D:/Apps/TwoCode/qa/step-claude-ui-${Date.now()}`;
const workspace = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(workspace, { recursive: true });
const pair = {
  dual: true,
  mode: "build",
  lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
  sidekick: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
};
if (!replay) await fs.writeFile(`${root}/data/preferences.json`, JSON.stringify(pair));
if (!replay)
  await fs.writeFile(
    `${workspace}/wait.mjs`,
    "import fs from 'node:fs';fs.writeFileSync(new URL('started.txt',import.meta.url),'started');setTimeout(()=>fs.writeFileSync(new URL('late.txt',import.meta.url),'bad'),12000);",
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
const repo = path.resolve(import.meta.dirname, "..");
const source = process.env.TWO_CODE_QA_SOURCE === "1";
const app = await electron.launch({
  executablePath: source
    ? path.join(repo, "node_modules/electron/dist/electron.exe")
    : process.env.TWO_CODE_QA_EXE || "D:/Apps/TwoCode/releases/0.8.1/win-unpacked/Two Code.exe",
  args: [...(source ? [path.join(repo, "packages/desktop")] : []), "--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [],
  results = [];
let page;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await sleep(250);
  }
  throw Error(`等待超时 ${timeout}ms`);
}
const read = async (id) => JSON.parse(await fs.readFile(`${root}/data/tasks/${id}.json`, "utf8"));
async function tasks() {
  const names = await fs.readdir(`${root}/data/tasks`).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  return Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5))));
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
async function approve(expectedTool, expectedText, reload = false) {
  const dialog = page.getByTestId("two-code-permission");
  await dialog.waitFor({ state: "visible", timeout: 120000 });
  if (reload) {
    await page.reload();
    await dialog.waitFor({ state: "visible", timeout: 15000 });
  }
  assert.equal(await dialog.getAttribute("data-tool"), expectedTool);
  assert((await dialog.innerText()).includes("需要权限 · 副手"), "权限卡未显示申请角色");
  assert((await dialog.innerText()).includes(expectedText), "权限内容不符合本题范围");
  await page.screenshot({ path: `${root}/permission-${expectedTool}.png`, animations: "disabled" });
  await dialog.getByRole("option", { name: "允许本次", exact: true }).focus();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
}
async function completed(id) {
  const task = await until(async () => {
    const permission = page.getByTestId("two-code-permission");
    if (await permission.isVisible())
      throw Error(`出现本题未授权的额外权限请求：${await permission.getAttribute("data-tool")}`);
    const t = await read(id);
    return t.status !== "running" && t;
  });
  assert.equal(task.status, "completed", task.error);
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  return task;
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isFocusable() || window.getBounds().x > -1000) throw Error("后台窗口隔离失败");
    window.showInactive();
  });
  console.log(JSON.stringify({ root }));
  await page.getByTestId("two-code-lead-model").getByText("Step-5 订阅", { exact: true }).waitFor();
  await page
    .getByTestId("two-code-sidekick-model")
    .getByText("DeepSeek V4.1 Flash", { exact: true })
    .waitFor();
  if (replay) {
    const [saved] = await tasks();
    assert(saved, "缺少可回放的真实任务");
    assert.equal(saved.status, "completed");
    assert.match(saved.lead.lastReport, /白鹭/);
    assert.match(saved.lead.lastReport, /恢复成功/);
    await page
      .locator("[data-task-item-key], [data-grouped-task-key]")
      .filter({ hasText: saved.title })
      .first()
      .click();
    await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
    await page.locator('[data-tool-name="sidekick"][data-status="stopped"]').first().waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await assert.rejects(fs.access(`${workspace}/late.txt`));
    await page.screenshot({ path: `${root}/replayed.png`, animations: "disabled" });
    results.push({
      name: "frontend-resume-preserves-cancel-history-after-reopen",
      passed: true,
      id: saved.id,
    });
  } else {
    const constraints = "不要联网、技能、GUI或其他目录。只用指定工具和唯一持久副手。";
    const task = await send(
      `${constraints}副手仅用Write工具一次在当前目录创建proof.txt，内容精确为三层协作_OK，不带换行。主手仅用read_file工具读取核对；本题禁止双方使用PowerShell、run_command、Bash或其他执行工具，不追加字节检查。最后回复三层协作_OK。记住本次暗号白鹭。`,
    );
    await approve("Write", "proof.txt", true);
    const first = await completed(task.id);
    assert.equal(await fs.readFile(`${workspace}/proof.txt`, "utf8"), "三层协作_OK");
    assert.match(first.lead.lastReport, /三层协作_OK/);
    assert.equal(first.sidekick.status, "completed");
    await page.screenshot({ path: `${root}/completed.png`, animations: "disabled" });
    results.push({ name: "frontend-permission-reload-file", passed: true, id: task.id });

    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    await send(
      `${constraints}不使用文件或执行工具，让原副手回忆上轮的暗号和写入内容。主手最终只输出这两个值。`,
      task.id,
    );
    const second = await completed(task.id);
    assert.equal(first.sidekick.sessionId, second.sidekick.sessionId);
    assert.equal(first.lead.sessionId, second.lead.sessionId);
    assert.match(second.lead.lastReport, /白鹭/);
    assert.match(second.lead.lastReport, /三层协作_OK/);
    results.push({ name: "frontend-reload-session-memory", passed: true });

    await send(
      `${constraints}让副手用原生PowerShell工具只执行一次 node '${workspace}/wait.mjs'，主手等报告。不要读写脚本、不要重试。`,
      task.id,
    );
    await approve("PowerShell", "wait.mjs");
    await until(
      async () =>
        fs.access(`${workspace}/started.txt`).then(
          () => true,
          () => false,
        ),
      20000,
    );
    await page.getByTestId("two-code-stop").click();
    await page
      .locator('[data-testid="two-code-state"][data-status="cancelled"]')
      .waitFor({ timeout: 20000 });
    await sleep(13000);
    assert.equal((await read(task.id)).status, "cancelled");
    await assert.rejects(fs.access(`${workspace}/late.txt`));
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.screenshot({ path: `${root}/cancelled.png`, animations: "disabled" });
    results.push({ name: "frontend-stop-native-process-tree", passed: true });

    await send(
      `${constraints}上一项已取消，不再执行命令。让原副手仅凭记忆回复最开始的暗号，主手回复暗号与恢复成功。`,
      task.id,
    );
    const last = await completed(task.id);
    assert.equal(last.sidekick.sessionId, first.sidekick.sessionId);
    assert.match(last.lead.lastReport, /白鹭/);
    assert.match(last.lead.lastReport, /恢复成功/);
    // 完成轮次会折叠，不按可见工具卡下标定位历史轮次。
    await page.locator('[data-tool-name="sidekick"][data-status="stopped"]').first().waitFor();
    await page.screenshot({ path: `${root}/resumed.png`, animations: "disabled" });
    results.push({ name: "frontend-resume-preserves-cancel-history", passed: true });
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ passed: false, error: String(error), stack: error.stack });
  await page?.screenshot({ path: `${root}/failure.png`, animations: "disabled" }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    `${root}/${replay ? "replay-results" : "results"}.json`,
    JSON.stringify({ root, results, errors }, null, 2),
  );
  console.log(JSON.stringify({ root, results, errors }));
  await app.close();
}
