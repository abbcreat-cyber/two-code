import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { projectTwoCodeRows } from "../packages/ui/src/two-code/conversationProjection.js";
const history = process.env.TWO_CODE_CODING_HISTORY;
if (!history) throw Error("提供本轮代码任务目录");
const root =
    process.env.TWO_CODE_CODING_UI_ROOT ?? `D:/Apps/TwoCode/qa/coding-history-ui-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IProviderSettingsService, ISettingService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const prepared = [];
for (const size of ["small", "medium", "long"]) {
  const original = JSON.parse(await fs.readFile(`${history}/${size}-final.json`, "utf8"));
  assert.equal(original.status, "completed");
  const created = await services.get(ITwoCodeService).create({
    workspacePath: cwd,
    title: `代码历史-${size}`,
    dual: true,
    mode: "edit",
    lead: original.lead.selection,
    sidekick: original.sidekick.selection,
  });
  const task = {
    ...original,
    id: created.id,
    title: created.title,
    workspacePath: created.workspacePath,
    lead: { ...original.lead, sessionId: undefined },
    sidekick: { ...original.sidekick, sessionId: undefined },
  };
  const rows = projectTwoCodeRows(task);
  const calls = rows.filter((r) => r.kind === "toolCall" && r.toolName === "sidekick");
  assert.equal(
    calls.length,
    task.events.filter((e: { kind: string }) => e.kind === "handoff").length,
  );
  assert(calls.every((r) => r.kind === "toolCall" && r.status === "success"));
  prepared.push(task);
}
await services.get(IProviderSettingsService).getView();
await services.get(ISettingService).update({
  lastWorkspaceSession: [{ kind: "local", workspacePath: await fs.realpath(cwd) }],
  lastActiveTabIndex: 0,
});
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
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.20"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const page = await app.firstWindow(),
  errors: string[] = [],
  checks: string[] = [];
let passed = false;
try {
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
    await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
    for (const button of await page
      .getByRole("button")
      .filter({ hasText: /已工作/ })
      .all()) {
      if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    }
    const visibleReports = page.locator('[data-tool-name="sidekick"]');
    await visibleReports.last().waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    // 展开工具后等待真实测高，避免把虚拟列表尚未重排的过渡帧当成交付截图。
    await page.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll('[data-v4-turn-unit="true"]')]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.height > 0)
          .sort((a, b) => a.top - b.top);
        return (
          rows.length > 0 &&
          rows.every((row, index) => index === 0 || row.top >= rows[index - 1].bottom - 2)
        );
      },
      undefined,
      { timeout: 5000 },
    );
    await page.screenshot({ path: `${root}/${task.title}.png`, animations: "disabled" });
    await page.reload();
    await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
    const stored = JSON.parse(await fs.readFile(`${root}/data/tasks/${task.id}.json`, "utf8"));
    assert.deepEqual(stored.events, task.events);
    assert.deepEqual(stored.usage, task.usage);
    checks.push(`${task.title}-render-reload-preserves-history`);
  }
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  console.log(String(error));
  await page.screenshot({ path: `${root}/failure.png` }).catch(() => {});
} finally {
  await app.close();
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify({ root, passed, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ root, passed, checks, errors }));
  if (!passed) process.exitCode = 1;
}
