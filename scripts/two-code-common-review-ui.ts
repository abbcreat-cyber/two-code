import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const history = process.env.TWO_CODE_REVIEW_HISTORY;
if (!history) throw Error("需要本轮真实交接证据目录");
const root = `D:/Apps/TwoCode/qa/common-review-ui-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(`${cwd}/ping.txt`, "PAIR_READY_91\n");
const originals = await Promise.all(
  ["revision", "async"].map(async (name) => ({
    name,
    task: JSON.parse(await fs.readFile(`${history}/${name}.json`, "utf8")),
  })),
);
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "edit",
    lead: originals[0]!.task.lead.selection,
    sidekick: originals[0]!.task.sidekick.selection,
  }),
);
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
for (const { name, task } of originals) {
  const created = await services.get(ITwoCodeService).create({
    workspacePath: cwd,
    title: name,
    dual: true,
    mode: "edit",
    lead: task.lead.selection,
    sidekick: task.sidekick.selection,
  });
  prepared.push({
    ...task,
    id: created.id,
    title: name,
    workspacePath: created.workspacePath,
    lead: { ...task.lead, sessionId: undefined },
    sidekick: { ...task.sidekick, sessionId: undefined },
  });
}
const live = await services
  .get(ITwoCodeService)
  .create({
    workspacePath: cwd,
    title: "真实读取验收",
    dual: true,
    mode: "edit",
    lead: originals[0]!.task.lead.selection,
    sidekick: originals[0]!.task.sidekick.selection,
  });
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
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR}/win-unpacked/Two Code.exe`,
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
    for (const b of await page
      .getByRole("button")
      .filter({ hasText: /已工作/ })
      .all())
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    const rows = page.locator('[data-tool-name="sidekick"]');
    assert.equal(await rows.count(), task.title === "revision" ? 2 : 1);
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      await row.locator('[data-testid^="tool-summary-trigger"]').first().click();
      const text = await row.innerText();
      if (task.title === "revision")
        assert(text.includes(i === 0 ? "REVISION_ONE" : "REVISION_TWO"));
      else assert.match(text, /ready|result\.json/);
      await row.screenshot({ path: `${root}/${task.title}-${i}.png` });
    }
    checks.push(`${task.title}-reports-in-original-tool`);
  }
  // 全局新任务使用默认工作区；文件验收从显式项目任务进入，不能误用另一个目录。
  await page
    .locator("[data-task-item-key], [data-grouped-task-key]")
    .filter({ hasText: "真实读取验收" })
    .first()
    .click();
  await page
    .getByTestId("two-code-composer")
    .fill(
      "让唯一副手读取当前工作区ping.txt并报告其中暗号。主手读取副手报告后用一句完整中文转述暗号。只用文件工具和sidekick，不执行命令、不联网、不改文件。",
    );
  await page.getByTestId("two-code-send").click();
  await page.locator('[data-testid="two-code-state"][data-status="running"]').waitFor();
  const end = Date.now() + 120000;
  while (
    Date.now() < end &&
    !(await page.locator('[data-testid="two-code-state"][data-status="completed"]').isVisible())
  ) {
    const deny = page
      .getByTestId("two-code-permission")
      .getByRole("option", { name: "拒绝", exact: true });
    if (await deny.isVisible()) await deny.press("Enter");
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(await page.locator('[data-testid="two-code-state"][data-status="completed"]').isVisible());
  const files = (await fs.readdir(`${root}/data/tasks`)).filter((n) => n.endsWith(".json"));
  const tasks = await Promise.all(
    files.map(async (name) => JSON.parse(await fs.readFile(`${root}/data/tasks/${name}`, "utf8"))),
  );
  const real = tasks.find((t) => t.id === live.id);
  assert(real);
  assert.equal(real.workspacePath, live.workspacePath);
  assert.equal(real.lead.selection.provider, "step-plan");
  assert.equal(real.sidekick.selection.harness, "claude-code");
  assert.match(real.lead.lastReport, /PAIR_READY_91/);
  assert.match(real.sidekick.lastReport, /PAIR_READY_91/);
  assert(real.events.some((e: { kind: string }) => e.kind === "handoff_report"));
  await fs.writeFile(`${root}/real-task.json`, JSON.stringify(real, null, 2));
  await page.reload();
  await page.locator('[data-testid="two-code-state"][data-status="completed"]').waitFor();
  checks.push("packaged-real-pair-and-reload");
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
