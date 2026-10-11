import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const root = `D:/Apps/TwoCode/qa/fusion-ui-${Date.now()}`;
const cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(
  `${cwd}/wait.mjs`,
  "import fs from 'node:fs';fs.appendFileSync(new URL('started.txt',import.meta.url),'once\\n');setTimeout(()=>fs.writeFileSync(new URL('late.txt',import.meta.url),'obsolete'),45000);",
);
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "edit",
    lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
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
  executablePath:
    process.env.TWO_CODE_QA_EXE || "D:/Apps/TwoCode/releases/0.8.4/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
let page;
const errors = [],
  result = { root };
const read = async () => {
  const names = (await fs.readdir(`${root}/data/tasks`).catch(() => [])).filter((n) =>
    n.endsWith(".json"),
  );
  return names.length
    ? JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"))
    : null;
};
async function until(predicate, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("真实界面验收超时");
}
async function approve() {
  const dialog = page.getByTestId("two-code-permission");
  await dialog.waitFor({ state: "visible", timeout: 120000 });
  assert.equal(await dialog.getAttribute("data-tool"), "PowerShell");
  assert((await dialog.innerText()).includes(`${cwd}/wait.mjs`));
  assert((await dialog.innerText()).includes("需要权限 · 副手"));
  await dialog.getByRole("option", { name: "允许本次", exact: true }).focus();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function expandWork() {
  for (const button of await page
    .getByRole("button")
    .filter({ hasText: /已工作/ })
    .all())
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByTestId("two-code-lead-model")
    .getByText("Step-5 订阅", { exact: true })
    .waitFor({ timeout: 40000 });
  await page
    .getByTestId("two-code-sidekick-model")
    .getByText("DeepSeek V4.1 Flash", { exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("后台隔离失败");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  console.log(JSON.stringify({ root }));
  await page
    .getByTestId("two-code-composer")
    .fill(
      `仅限当前工作区${cwd}，不用联网、GUI或技能。让唯一副手用原生PowerShell执行一次 node '${cwd}/wait.mjs'，run_in_background为false；主手阻塞等报告。不读取或修改脚本，不重试，不使用其他工具。`,
    );
  await page.getByTestId("two-code-send").click();
  await approve();
  await until(
    () =>
      fs.access(`${cwd}/started.txt`).then(
        () => true,
        () => false,
      ),
    30000,
  );
  const before = await read(),
    started = Date.now();
  const update = `需求修改：立刻通知正在运行的同一副手停止原等待，不重跑命令；让它只用Write创建${cwd}/updated.txt，内容STEER_UI_OK。主手read_file核对后报告，不创建第二个副手。`;
  await page.getByTestId("two-code-composer").fill(update);
  assert.equal(await page.getByTestId("two-code-send").getAttribute("aria-label"), "发送补充");
  assert(await page.getByTestId("two-code-stop").isVisible());
  await page.screenshot({ path: `${root}/busy-composer.png`, animations: "disabled" });
  await page.getByTestId("two-code-send").click();
  const done = await until(async () => {
    const task = await read();
    return task?.events.some((e) => e.continuation) && task.status !== "running" && task;
  });
  result.updateCompletionMs = Date.now() - started;
  assert.equal(done.status, "completed", done.error);
  assert.equal((await fs.readFile(`${cwd}/updated.txt`, "utf8")).trim(), "STEER_UI_OK");
  assert.equal(done.sidekick.sessionId, before.sidekick.sessionId);
  assert.equal(
    done.events.filter((e) => e.role === "sidekick" && e.kind === "status" && e.text === "开始执行")
      .length,
    1,
  );
  assert.equal(done.events.filter((e) => e.kind === "handoff").length, 1);
  assert(done.events.some((e) => e.kind === "handoff_update"));
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  await expandWork();
  assert.equal(await page.locator('[data-tool-name="sidekick"]').count(), 1);
  await page.reload();
  await page.getByTestId("two-code-state").waitFor();
  await expandWork();
  await page.getByText(update, { exact: true }).waitFor();
  assert.equal(await page.locator('[data-tool-name="sidekick"]').count(), 1);
  await page.screenshot({ path: `${root}/replayed.png`, animations: "disabled" });
  const remaining = 46000 - (Date.now() - started);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  await assert.rejects(fs.access(`${cwd}/late.txt`));
  assert.equal(await fs.readFile(`${cwd}/started.txt`, "utf8"), "once\n");
  // 第二轮验证新增补充入口没有破坏停止操作；仍只运行本题精确夹具。
  await page
    .getByTestId("two-code-composer")
    .fill(
      `新一轮停止验收：让原副手用原生PowerShell执行一次 node '${cwd}/wait.mjs'，run_in_background为false，主手阻塞等报告。不读写脚本、不用其他工具。`,
    );
  await page.getByTestId("two-code-send").click();
  await approve();
  await until(
    async () => (await fs.readFile(`${cwd}/started.txt`, "utf8")) === "once\nonce\n",
    30000,
  );
  await page.getByTestId("two-code-stop").click();
  await page
    .locator('[data-testid="two-code-state"][data-status="cancelled"]')
    .waitFor({ timeout: 20000 });
  await new Promise((r) => setTimeout(r, 46000));
  await assert.rejects(fs.access(`${cwd}/late.txt`));
  assert.equal((await read()).status, "cancelled");
  assert.deepEqual(errors, []);
  Object.assign(result, {
    passed: true,
    sameSidekick: true,
    oneHandoff: true,
    replay: true,
    stop: true,
  });
} catch (error) {
  Object.assign(result, { passed: false, error: String(error) });
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png`, animations: "disabled" }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  if ((await read())?.status === "running" && page)
    await page
      .getByTestId("two-code-stop")
      .click()
      .catch(() => {});
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
  await app.close();
}
