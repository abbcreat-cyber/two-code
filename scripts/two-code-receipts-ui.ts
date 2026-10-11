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
const repairRoot = process.env.TWO_CODE_REPAIR_CYCLE_ROOT;
const cases = repairRoot
  ? [
      ["原生退出码", `${repairRoot}/first-failed.json`],
      ["修复回执", `${repairRoot}/second-repaired.json`],
    ]
  : [
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
      ...(process.env.TWO_CODE_WARNING_TASK
        ? [["警告回执", process.env.TWO_CODE_WARNING_TASK]]
        : []),
      ...(process.env.TWO_CODE_DENIED_TASK ? [["副手拒绝", process.env.TWO_CODE_DENIED_TASK]] : []),
      ...(process.env.TWO_CODE_INTERRUPTED_TASK
        ? [["执行中断", process.env.TWO_CODE_INTERRUPTED_TASK]]
        : []),
      ...(process.env.TWO_CODE_LEAD_DENIED_TASK
        ? [["主手拒绝", process.env.TWO_CODE_LEAD_DENIED_TASK]]
        : []),
      ...(process.env.TWO_CODE_UPDATE_ERRORS_DIR
        ? [
            ["用户补充失败", `${process.env.TWO_CODE_UPDATE_ERRORS_DIR}/user-update.json`],
            ["副手补充失败", `${process.env.TWO_CODE_UPDATE_ERRORS_DIR}/sidekick-update.json`],
          ]
        : []),
    ];
for (const [title, file] of cases) {
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
    if (task.title.endsWith("补充失败")) {
      for (const replay of [false, true]) {
        if (replay) await page.reload();
        await page.locator('[data-testid="two-code-state"][data-status="error"]').waitFor();
        await page
          .getByRole("alert")
          .filter({ hasText: /未确认送达/ })
          .waitFor();
        const saved = JSON.parse(await fs.readFile(`${root}/data/tasks/${task.id}.json`, "utf8"));
        assert.equal(saved.status, "error");
        assert.deepEqual(saved.permissions, []);
        assert.deepEqual(saved.events, task.events, "重开不能自动恢复失败任务或更改历史");
      }
      await page.screenshot({ path: `${root}/${task.title}.png`, animations: "disabled" });
      results.push({ title: task.title, passed: true });
      continue;
    }
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
    const row = task.title === "修复回执" ? target.last() : target.first();
    await row.waitFor();
    const trigger = row.locator('[data-testid^="tool-summary-trigger"]').first();
    await trigger.click();
    if (repairRoot) await row.getByText(/^result$/i, { exact: true }).scrollIntoViewIfNeeded();
    await row
      .getByText(leadDenied ? /未执行：本次操作未获批准/ : /原生执行回执/)
      .first()
      .waitFor();
    const body = await row.innerText();
    if (task.title === "原生退出码") {
      // CodeViewer使用Shadow DOM，父节点innerText不含实际代码；定位器穿透后核对可见回执。
      await row
        .getByText(/"reportedExitCode"\s*:\s*7\s*[,}]/)
        .first()
        .waitFor();
    }
    await fs.writeFile(`${root}/${task.title}-text.txt`, body);
    assert(body.includes(leadDenied ? "未执行" : "原生执行回执"), "状态必须位于原工具详情内");
    assert(
      task.title === "原生退出码"
        ? await row
            .getByText(/"reportedExitCode"\s*:\s*7\s*[,}]/)
            .first()
            .isVisible()
        : body.includes(
            repairRoot
              ? task.title === "原生退出码"
                ? '"reportedExitCode":7'
                : "PASS: REPAIRED"
              : leadDenied
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
    if (task.title === "修复回执") {
      const receipt = task.events.findLast(
        (e: { role: string; kind: string }) => e.role === "sidekick" && e.kind === "verification",
      );
      assert(receipt && !receipt.text.includes("FAIL: OLD"));
      // 模型可在报告中比较修复前后；只核对当前结构化回执，不把合法历史说明误判为串位。
      await row.getByText(`原生执行回执：${receipt.text}`, { exact: false }).first().waitFor();
    }
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
