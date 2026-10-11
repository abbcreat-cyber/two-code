import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const root = `D:/Apps/TwoCode/qa/receipts-ui-${Date.now()}`,
  cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const prepared = [];
const historyRoot = process.env.TWO_CODE_RECEIPTS_HISTORY_ROOT;
for (const [title, file] of [
  [
    "成功回执",
    historyRoot
      ? `${historyRoot}/success-final.json`
      : "D:/Apps/TwoCode/qa/efficiency-receipts-candidate-1791699649372/repair-1.json",
  ],
  [
    "失败回执",
    historyRoot
      ? `${historyRoot}/failure-final.json`
      : "D:/Apps/TwoCode/qa/efficiency-receipts-final-1791699869596/failure-2.json",
  ],
  ...(process.env.TWO_CODE_WARNING_TASK ? [["警告回执", process.env.TWO_CODE_WARNING_TASK]] : []),
  ...(process.env.TWO_CODE_DENIED_TASK ? [["副手拒绝", process.env.TWO_CODE_DENIED_TASK]] : []),
  ...(process.env.TWO_CODE_INTERRUPTED_TASK
    ? [["执行中断", process.env.TWO_CODE_INTERRUPTED_TASK]]
    : []),
  ...(process.env.TWO_CODE_LEAD_DENIED_TASK
    ? [["主手拒绝", process.env.TWO_CODE_LEAD_DENIED_TASK]]
    : []),
]) {
  const original = JSON.parse(await fs.readFile(file!, "utf8"));
  const created = await service.create({
    workspacePath: cwd,
    title,
    dual: true,
    mode: "edit",
    lead: original.lead.selection,
    sidekick: original.sidekick.selection,
  });
  prepared.push({
    ...original,
    id: created.id,
    title: created.title,
    workspacePath: created.workspacePath,
    lead: { ...original.lead, sessionId: undefined },
    sidekick: { ...original.sidekick, sessionId: undefined },
  });
}
await service.catalog();
await services.get(IProviderSettingsService).getView();
await disposeServiceResourcesAndWait(services);
for (const task of prepared)
  await fs.writeFile(`${root}/data/tasks/${task.id}.json`, JSON.stringify(task));
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.9"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const errors: string[] = [],
  results: { title: string; passed: boolean }[] = [];
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("isolation");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  for (const task of prepared) {
    await page
      .locator("[data-task-item-key], [data-grouped-task-key]")
      .filter({ hasText: task.title })
      .first()
      .click();
    await page.getByTestId("two-code-state").waitFor();
    for (const b of await page
      .getByRole("button")
      .filter({ hasText: /已工作/ })
      .all())
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    const leadDenied = task.title === "主手拒绝";
    const target = page.locator(
      leadDenied ? '[data-tool-name="powershell"]' : '[data-tool-name="sidekick"]',
    );
    if (leadDenied) assert.equal(await target.count(), 1, "拒绝消息不应产生重复工具行");
    const row = target.first();
    await row.waitFor();
    const trigger = row.locator('[data-testid^="tool-summary-trigger"]').first();
    await trigger.click();
    await page
      .getByText(leadDenied ? /未执行：本次操作未获批准/ : /原生执行回执/)
      .first()
      .waitFor();
    const body = await row.innerText();
    assert(body.includes(leadDenied ? "未执行" : "原生执行回执"), "状态必须位于原工具详情内");
    assert(
      body.includes(
        leadDenied
          ? "未执行"
          : task.title === "副手拒绝"
            ? "not-executed"
            : task.title === "执行中断"
              ? "interrupted"
              : task.title === "成功回执"
                ? "3 checks passed"
                : task.title === "警告回执"
                  ? "WARN: optional fixture notice"
                  : historyRoot
                    ? "FAIL: fixture"
                    : "FAIL: intentional fixture",
      ),
    );
    await row.screenshot({ path: `${root}/${task.title}.png`, animations: "disabled" });
    results.push({ title: task.title, passed: true });
  }
  assert.deepEqual(errors, []);
} catch (e) {
  process.exitCode = 1;
  await fs.writeFile(`${root}/error.txt`, String(e));
  await page?.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  console.log(String(e));
} finally {
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, results, errors }, null, 2));
  console.log(JSON.stringify({ root, results, errors }));
  await app.close();
}
