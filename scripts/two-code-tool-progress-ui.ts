import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { TaskLease } from "../packages/services/src/two-code/adapters/task-lease.js";
const root = `D:/Apps/TwoCode/qa/tool-progress-ui-${Date.now()}`,
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
});
const service = services.get(ITwoCodeService);
const original = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/qa/variety-progress-1791702472463/draw.json", "utf8"),
);
const task = await service.create({
  workspacePath: cwd,
  title: "真实文件草稿流回放",
  dual: true,
  mode: "edit",
  lead: original.lead.selection,
  sidekick: original.sidekick.selection,
});
await service.catalog();
await services.get(IProviderSettingsService).getView();
await disposeServiceResourcesAndWait(services);
const progress = original.events.filter(
  (e: any) => e.kind === "tool_input" && JSON.parse(e.text).preview?.length > 1000,
);
const first = progress[0],
  next = progress.find(
    (e: any) =>
      e.toolCallId === first.toolCallId &&
      JSON.parse(e.text).characters > JSON.parse(first.text).characters + 1000,
  );
assert(first && next);
const file = `${root}/data/tasks/${task.id}.json`;
const save = async (event: any, status = "running") =>
  fs.writeFile(
    file,
    JSON.stringify({
      ...original,
      id: task.id,
      title: task.title,
      workspacePath: task.workspacePath,
      status,
      lead: { ...original.lead, sessionId: undefined, status },
      sidekick: { ...original.sidekick, sessionId: undefined },
      events: original.events.filter((e: any) => e.seq <= event.seq),
    }),
  );
// 回放真实事件前缀，由测试进程持有隔离租约；不写生产数据，也不启动模型或工具。
const release = await new TaskLease(`${root}/data`).acquire(task.id);
await save(first);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "D:/Apps/TwoCode/releases/0.8.10/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const errors: string[] = [],
  results: Record<string, unknown> = { root };
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
  const select = async () => {
    await page!
      .locator("[data-task-item-key], [data-grouped-task-key]")
      .filter({ hasText: task.title })
      .first()
      .click();
    await page!.getByTestId("two-code-state").waitFor();
  };
  await select();
  for (const [stage, event] of [
    ["first", first],
    ["updated", next],
  ] as const) {
    if (stage === "updated") {
      await save(event);
      await page.reload();
      await select();
    }
    const count = JSON.parse(event.text).characters;
    await page
      .getByText(`正在生成文件内容 · ${count} 字符`, { exact: false })
      .first()
      .waitFor({ timeout: 20000 });
    const row = page.locator('[data-tool-name="write_file"]').first();
    const trigger = row.locator('[data-testid^="tool-summary-trigger"]').first();
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await row
      .getByText(/内容生成中，尚未开始执行/)
      .first()
      .waitFor({ timeout: 5000 });
    await row.screenshot({ path: `${root}/${stage}.png`, animations: "disabled" });
    await fs.writeFile(`${root}/${stage}.html`, await row.evaluate((el) => el.outerHTML));
    assert((await row.innerText()).includes("<svg"));
    results[stage] = { characters: count, visible: true };
  }
  await save(next, "cancelled");
  await page.reload();
  await select();
  const row = page.locator('[data-tool-name="write_file"]').first();
  const trigger = row.locator('[data-testid^="tool-summary-trigger"]').first();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await row
    .getByText(/未取得该工具的完成回执/)
    .first()
    .waitFor({ timeout: 5000 });
  await row.screenshot({ path: `${root}/cancelled.png`, animations: "disabled" });
  results.cancelled = true;
  assert.deepEqual(errors, []);
  results.passed = true;
} catch (e) {
  results.passed = false;
  results.error = String(e);
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  await app.close();
  await release();
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ ...results, errors }, null, 2));
  console.log(JSON.stringify(results));
}
