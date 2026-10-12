import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/reports/stream-ui-${Date.now()}`;
await fs.mkdir(`${root}/data/tasks`, { recursive: true });
const ids = ["e97d7964-c29c-4fcc-a6c2-dc297748cbd5", "3e73a08e-475d-4dfc-9e05-eeafc265f569"];
const workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
for (const id of ids) {
  const task = JSON.parse(await fs.readFile(`D:/Apps/TwoCode/data/tasks/${id}.json`, "utf8"));
  task.workspacePath = workspace;
  await fs.writeFile(`${root}/data/tasks/${id}.json`, JSON.stringify(task));
}
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: `${root}/data`,
  ZCODE_DATA_BASE_DIR: `${root}/data`,
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code Stream UI QA",
};
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.TWO_CODE_QA_EXE;
const app = await electron.launch({
  executablePath: exe || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(exe ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
  timeout: 60000,
});
let page;
const errors = [];
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("Not isolated");
    w.showInactive();
  });
  await page.locator(`[data-testid*="task-item"][data-testid$="${ids[0]}"]`).click();
  const lead = page.getByTestId("two-code-lead-usage"),
    side = page.getByTestId("two-code-sidekick-usage");
  await lead.waitFor();
  await side.waitFor();
  await lead.click();
  assert.equal(
    await page.getByTestId("two-code-lead-usage-panel").getByTestId("role-token-total").innerText(),
    "68,973",
  );
  await page.screenshot({ animations: "disabled", path: `${root}/lead-usage.png` });
  await lead.click();
  await side.click();
  const panel = page.getByTestId("two-code-sidekick-usage-panel");
  assert.equal(await panel.getByTestId("role-token-total").innerText(), "0");
  assert((await panel.innerText()).includes("未调用"));
  await page.screenshot({ animations: "disabled", path: `${root}/sidekick-unused.png` });
  await side.click();
  await page
    .getByRole("button", { name: /已工作/ })
    .last()
    .click();
  const receipt = page
    .getByTestId("two-code-native-tool-receipt")
    .filter({ hasText: "落日长河.svg" })
    .last();
  await receipt.waitFor({ state: "visible" });
  assert.equal(await page.getByText("原生工具已完成。", { exact: true }).count(), 0);
  await receipt.getByRole("button").first().click();
  await receipt.getByTestId("two-code-tool-draft").waitFor({ state: "visible" });
  await page.screenshot({ animations: "disabled", path: `${root}/tool-receipt.png` });
  const start = performance.now();
  await page.locator(`[data-testid*="task-item"][data-testid$="${ids[1]}"]`).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="two-code-state"]')?.getAttribute("data-status") ===
      "cancelled",
  );
  const loadMs = Math.round(performance.now() - start);
  await app.evaluate(({ app }) => app.getAppMetrics());
  await page.waitForTimeout(2000);
  const metrics = await app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .map((m) => ({
        type: m.type,
        cpu: m.cpu.percentCPUUsage,
        workingSetKB: m.memory.workingSetSize,
      })),
  );
  await page.screenshot({ animations: "disabled", path: `${root}/large-history.png` });
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify(
      {
        passed: true,
        sourceTasks: ids,
        loadMs,
        metrics,
        errors,
        separateRolePanels: true,
        unusedSidekickZero: true,
        legacySuccessBlockRemoved: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, root, loadMs, metrics, errors }));
} catch (error) {
  if (page)
    await page.screenshot({ animations: "disabled", path: `${root}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
