import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const root = `D:/Apps/TwoCode/qa/opening-ui-${Date.now()}`;
const cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(`${cwd}/items.json`, '[{"name":"甲","amount":4},{"name":"乙","amount":7}]');
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
  executablePath: "D:/Apps/TwoCode/releases/0.8.3/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
let page;
const errors = [];
const result = { root };
const read = async () => {
  const names = (await fs.readdir(`${root}/data/tasks`).catch(() => [])).filter((n) =>
    n.endsWith(".json"),
  );
  return names.length
    ? JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"))
    : null;
};
async function until(predicate) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("真实UI任务超时");
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
    w.showInactive();
  });
  const started = Date.now();
  await page
    .getByTestId("two-code-composer")
    .fill(
      '请整理当前目录items.json，让唯一副手用Read/Write计算amount总和，写入total.json格式{"sum":数字}。主手read_file核对。只用文件工具，不用shell、联网、技能、GUI或其他目录。记住暗号海棠，不写入文件。',
    );
  await page.getByTestId("two-code-send").click();
  const prose = page
    .locator('[class~="group/assistant-row"] [data-conversation-selectable="true"]')
    .first();
  await prose.waitFor({ timeout: 45000 });
  await until(async () => (await prose.innerText()).trim().length > 5);
  result.firstProseMs = Date.now() - started;
  result.opening = await prose.innerText();
  result.openingWhileRunning = await page.getByTestId("two-code-stop").isVisible();
  assert(result.openingWhileRunning);
  await page.screenshot({ path: `${root}/opening.png`, animations: "disabled" });
  const first = await until(async () => {
    const task = await read();
    return task && task.status !== "running" && task;
  });
  assert.equal(first.status, "completed", first.error);
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/total.json`, "utf8")), { sum: 11 });
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  // 完成后直接发下一轮，不人为等待清理，也不重试发送。
  await page
    .getByTestId("two-code-composer")
    .fill("让原副手仅凭记忆回忆暗号，不用文件或执行工具。只回答暗号。");
  await page.getByTestId("two-code-send").click();
  const second = await until(async () => {
    const task = await read();
    return task && task.requestIds.length === 2 && task.status !== "running" && task;
  });
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
  assert.match(second.lead.lastReport, /海棠/);
  await page.reload();
  await page.getByTestId("two-code-state").waitFor();
  for (const button of await page
    .getByRole("button")
    .filter({ hasText: /已工作/ })
    .all())
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await page.getByText(result.opening, { exact: false }).first().waitFor();
  await page.screenshot({ path: `${root}/replayed.png`, animations: "disabled" });
  assert.deepEqual(errors, []);
  Object.assign(result, { passed: true, sameSidekick: true, immediateFollowup: true });
} catch (error) {
  Object.assign(result, { passed: false, error: String(error) });
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png`, animations: "disabled" }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
  await app.close();
}
