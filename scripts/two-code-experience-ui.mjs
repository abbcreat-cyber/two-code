import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const root = `D:/Apps/TwoCode/qa/experience-ui-${Date.now()}/中文 空格`;
const cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
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
    process.env.TWO_CODE_QA_EXE || "D:/Apps/TwoCode/releases/0.8.5/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [],
  result = { root };
let page;
async function read() {
  const names = (await fs.readdir(`${root}/data/tasks`).catch(() => [])).filter((n) =>
    n.endsWith(".json"),
  );
  return names.length
    ? JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"))
    : null;
}
async function until(fn, timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("整体体验验收超时");
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
      `只操作当前工作区。第一步明确由主手亲自执行，不派副手：用原生powershell执行一次 Set-Content -LiteralPath '${cwd}/obsolete.txt' -Value 'OLD'。不要用其他工具或命令，不联网、技能、GUI。`,
    );
  await page.getByTestId("two-code-send").click();
  const permission = page.getByTestId("two-code-permission");
  await permission.waitFor({ state: "visible", timeout: 120000 });
  assert.equal(await permission.getAttribute("data-tool"), "powershell");
  assert((await permission.innerText()).includes("obsolete.txt"));
  assert.equal(await page.getByTestId("two-code-state").innerText(), "待确认 · 主手");
  const before = await read();
  const update =
    "撤销尚未批准的主手命令，不写obsolete.txt、不执行任何命令。让唯一副手只用Write在当前目录创建answer.txt，内容42；主手read_file核对。不要联网、GUI或技能。";
  await page.getByTestId("two-code-composer").fill(update);
  await page.reload();
  await permission.waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("two-code-composer").innerText(), update);
  await page.screenshot({ path: `${root}/pending-permission.png`, animations: "disabled" });
  const started = Date.now();
  await page.getByTestId("two-code-send").click();
  await permission.waitFor({ state: "hidden", timeout: 10000 });
  result.permissionWithdrawalMs = Date.now() - started;
  const done = await until(async () => {
    const t = await read();
    return t?.events.some((e) => e.continuation) && t.status !== "running" && t;
  });
  assert.equal(done.status, "completed", done.error);
  assert.equal(done.lead.sessionId, before.lead.sessionId);
  assert.equal((await fs.readFile(`${cwd}/answer.txt`, "utf8")).trim(), "42");
  await assert.rejects(fs.access(`${cwd}/obsolete.txt`));
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  assert(done.events.some((e) => e.notExecuted && e.text.includes("未获批准")));
  for (const button of await page
    .getByRole("button")
    .filter({ hasText: /已工作/ })
    .all())
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await page.getByText(/powershell · 未执行：本次操作未获批准/).waitFor();
  await page.screenshot({ path: `${root}/withdrawn-tool.png`, animations: "disabled" });
  await page
    .getByTestId("two-code-composer")
    .fill(
      "一次批量调整：已核实答案42，不重新计算。让原副手仅用Write把answer.txt改为43并新增note.txt内容已改为43，主手read_file核对这两个产物。不用命令、联网、GUI或技能。",
    );
  await page.getByTestId("two-code-send").click();
  const next = await until(async () => {
    const t = await read();
    return t?.requestIds.length === 3 && t.status !== "running" && t;
  });
  assert.equal(next.status, "completed", next.error);
  assert.equal(next.sidekick.sessionId, done.sidekick.sessionId);
  assert.equal((await fs.readFile(`${cwd}/answer.txt`, "utf8")).trim(), "43");
  assert.equal((await fs.readFile(`${cwd}/note.txt`, "utf8")).trim(), "已改为43");
  await page.reload();
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  assert.equal(await permission.count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({ path: `${root}/replayed.png`, animations: "disabled" });
  assert.deepEqual(errors, []);
  Object.assign(result, {
    passed: true,
    unicodeSpacePath: true,
    sameSidekick: true,
    batch: true,
    permissionReload: true,
    draftReplay: true,
    oldCommandNotExecuted: true,
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
