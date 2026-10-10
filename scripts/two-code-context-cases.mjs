import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export async function runContextCases({ page, root, tasks, fresh, send, completed, checkCase }) {
  await checkCase("task-error-scope", async () => {
    await fresh();
    const file = path.join(root, "data/model-connections.json");
    const original = await fs.readFile(file).catch(() => undefined);
    let failed;
    try {
      await fs.writeFile(file, "{broken");
      await page.getByTestId("two-code-composer").fill("只回答SCOPE_OK，不使用工具。");
      await page.getByTestId("two-code-send").click();
      const alert = page.getByRole("alert").filter({ hasText: /模型配置损坏/ });
      await alert.waitFor({ timeout: 15000 });
      failed = (await tasks()).findLast((t) => t.status === "idle");
      assert(failed);
      await fresh();
      assert.equal(await alert.count(), 0, "task failure leaked into new draft");
      await page.locator(`[data-testid*="task-item"][data-testid$="${failed.id}"]`).click();
      await alert.waitFor({ timeout: 5000 });
      assert.equal((await page.getByTestId("two-code-state").innerText()).trim(), "未开始");
    } finally {
      if (original) await fs.writeFile(file, original);
      else await fs.rm(file, { force: true });
    }
    await send("只回答SCOPE_OK，不使用工具。", failed.id);
    assert.match((await completed(failed.id)).lead.lastReport, /SCOPE_OK/);
    assert.equal(
      await page
        .getByRole("alert")
        .filter({ hasText: /模型配置损坏/ })
        .count(),
      0,
    );
  });
  await checkCase("default-notice-scope", async () => {
    await fresh();
    const task = await send("只回复NOTICE_OK，不派工，不使用其他工具。");
    await completed(task.id);
    await page.getByTestId("two-code-mode").click();
    const panel = page.getByTestId("two-code-collaboration-panel");
    await panel.getByRole("button", { name: "将当前配置设为默认", exact: true }).click();
    await panel.getByText("已保存，以后新建任务使用此配置", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await fresh();
    await page.getByTestId("two-code-mode").click();
    assert.equal(
      await panel.getByRole("status").count(),
      0,
      "old default-save notice leaked into new draft",
    );
    await page.keyboard.press("Escape");
  });
}
