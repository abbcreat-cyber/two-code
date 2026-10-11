import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const snapshot = process.env.TWO_CODE_LAYOUT_SNAPSHOT;
assert(snapshot, "指定真实任务快照 TWO_CODE_LAYOUT_SNAPSHOT");
const root = `D:/Apps/TwoCode/qa/tool-layout-${Date.now()}`;
const workspace = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(`${root}/data/tasks`, { recursive: true });
const real = JSON.parse(await fs.readFile(snapshot, "utf8"));
assert.equal(real.status, "completed");
real.workspacePath = workspace;
real.title = "真实双角色修改任务回放";
const legacy = { ...real, title: "旧工具记录布局夹具", events: [] };
for (const [role, kind, text] of [
  ["user", "message", "布局夹具：覆盖已有工具名称和长名称"],
  ["lead", "message", "读取、写入、修改和命令工具均沿用原版工具摘要位置。"],
  ...["write_file", "edit_file", "read_file", "run_command", "tool_" + "long_name_".repeat(16)].map(
    (name) => ["lead", "tool", name],
  ),
  ["lead", "status", "执行已结束，待核对结果"],
])
  legacy.events.push({ seq: legacy.events.length + 1, at: real.updatedAt, role, kind, text });
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "edit",
    lead: real.lead.selection,
    sidekick: real.sidekick.selection,
  }),
);
const repo = path.resolve(import.meta.dirname, "..");
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
process.env.ZCODE_HOME = `${root}/data/.zcode`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.join(repo, "config/provider/zcode-builtin.json"),
});
for (const task of [real, legacy]) {
  const created = await services.get(ITwoCodeService).create({
    workspacePath: workspace,
    title: task.title,
    dual: true,
    lead: real.lead.selection,
    sidekick: real.sidekick.selection,
  });
  task.id = created.id;
  task.workspacePath = created.workspacePath;
}
await services.get(ITwoCodeService).catalog();
await services.get(IProviderSettingsService).getView();
await disposeServiceResourcesAndWait(services);
// 经服务创建原生侧栏索引后，装载只读回放快照；不调用模型、不改原任务。
for (const task of [real, legacy])
  await fs.writeFile(`${root}/data/tasks/${task.id}.json`, JSON.stringify(task));
const executable = process.env.TWO_CODE_QA_EXE;
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
  executablePath: executable || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(executable ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [],
  results = [];
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    assertBackground(w);
    function assertBackground(window) {
      if (window.isFocusable() || window.getBounds().x > -1000) throw Error("不是隔离后台窗口");
    }
    w.setSize(1280, 1000);
    w.showInactive();
  });
  for (const task of [real, legacy]) {
    await page
      .locator("[data-task-item-key], [data-grouped-task-key]")
      .filter({ hasText: task.title })
      .first()
      .click();
    await page.getByTestId("two-code-state").waitFor();
    const summaries = page.getByRole("button").filter({ hasText: /已工作/ });
    for (const summary of await summaries.all())
      if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
    const rows = page.locator('[data-harness-tool-activity="true"]');
    await rows.first().waitFor();
    const measured = await rows.evaluateAll((elements) =>
      elements.map((el) => {
        const row = el.getBoundingClientRect();
        const icon = el.querySelector("svg")?.getBoundingClientRect();
        const summary =
          el.querySelector('[data-testid^="tool-summary-trigger"]') ??
          el.querySelector(".group\\/tool-summary");
        return {
          left: row.x,
          width: row.width,
          iconLeft: icon?.x,
          label: el.textContent,
          textAlign: summary ? getComputedStyle(summary).textAlign : null,
          emptyButtons: el.querySelectorAll('[role="button"]').length,
          hasDivider: !!el.querySelector(".h-px"),
        };
      }),
    );
    assert(measured.length >= (task === real ? 1 : 5));
    for (const row of measured) {
      assert(
        row.iconLeft !== undefined && Math.abs(row.iconLeft - row.left) <= 16,
        "工具图标未沿原版左侧对齐",
      );
      assert.equal(row.textAlign, "left");
      assert.equal(row.hasDivider, false);
      assert.equal(row.emptyButtons, 0);
    }
    await page.screenshot({
      path: `${root}/${task === real ? "real" : "legacy"}.png`,
      animations: "disabled",
    });
    results.push({ case: task === real ? "real-history" : "legacy-fixture", measured });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 900));
  await page.screenshot({ path: `${root}/narrow.png`, animations: "disabled" });
  const overflow = await page
    .locator('[data-harness-tool-activity="true"]')
    .evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 2));
  assert.equal(overflow, false, "长工具名横向溢出");
  await page.reload();
  await page.locator('[data-harness-tool-activity="true"]').first().waitFor();
  if (process.env.TWO_CODE_LAYOUT_LIVE === "1") {
    await page
      .getByRole("button", { name: /^新建任务/ })
      .first()
      .click();
    await page
      .getByTestId("two-code-composer")
      .fill(
        "真实小任务：仅当前目录，禁止联网、技能、GUI、shell。让唯一副手仅心算13+4，不用其他工具。主手收到副手报告后，必须自己依次使用write_file创建layout.txt内容17，edit_file改为18，再read_file读取核对。不让副手操作文件。最终只回复18。",
      );
    await page.getByTestId("two-code-send").click();
    const deadline = Date.now() + 180000;
    let liveTask;
    while (Date.now() < deadline) {
      for (const name of await fs.readdir(`${root}/data/tasks`)) {
        if (!name.endsWith(".json") || [real.id, legacy.id].some((id) => name === `${id}.json`))
          continue;
        liveTask = JSON.parse(await fs.readFile(`${root}/data/tasks/${name}`, "utf8"));
      }
      if (liveTask && liveTask.status !== "running") break;
      if (await page.getByTestId("two-code-permission").isVisible())
        throw Error("原生编辑工具额外索取权限");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(liveTask?.status, "completed", liveTask?.error);
    assert.equal((await fs.readFile(`${workspace}/layout.txt`, "utf8")).trim(), "18");
    for (const name of ["write_file", "edit_file", "read_file"])
      assert(
        liveTask.events.some((e) => e.role === "lead" && e.kind === "tool" && e.text === name),
      );
    assert.equal(liveTask.sidekick.status, "completed");
    assert(!liveTask.events.some((e) => e.role === "sidekick" && e.kind === "tool"));
    const history = page.getByRole("button").filter({ hasText: /已工作/ });
    for (const button of await history.all())
      if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    const liveRows = page.locator('[data-harness-tool-activity="true"]');
    await liveRows.first().waitFor();
    assert((await liveRows.count()) >= 3);
    await page.screenshot({ path: `${root}/live.png`, animations: "disabled" });
    results.push({ case: "real-pair-write-edit-read", passed: true, id: liveTask.id });
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ error: String(error) });
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png`, animations: "disabled" }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, results, errors }, null, 2));
  console.log(JSON.stringify({ root, results, errors }));
  await app.close();
}
