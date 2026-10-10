import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export async function runRecoveryCases({ page, root, send, fresh, completed, checkCase, read }) {
  await checkCase("statistics-breakdown", async () => {
    await fresh();
    const task = await send("只回复STATS_OK，不派工，不使用工具。");
    const done = await completed(task.id);
    assert(done.usage.length > 0);
    // 展示边界使用隔离回执夹具，不把注入数字当作上游真实计费。
    done.usage = [{ ...done.usage[0], cacheWriteTokens: 123, modelMs: 119600 }];
    await fs.writeFile(path.join(root, `data/tasks/${task.id}.json`), JSON.stringify(done));
    await page.reload();
    await page.getByTestId("session-token-usage-trigger").click();
    const tokens = page.getByTestId("session-token-usage-details");
    await tokens.waitFor();
    assert.equal(
      await tokens.getByText("缓存写入", { exact: true }).count(),
      1,
      "cache creation tokens absent from billing breakdown",
    );
    assert.equal(
      await tokens
        .locator("dt")
        .filter({ hasText: /^缓存写入$/ })
        .locator("..")
        .locator("dd")
        .innerText(),
      "123 tok",
    );
    const receipt = done.usage[0];
    const total =
      receipt.inputTokens +
      receipt.outputTokens +
      receipt.cacheReadTokens +
      receipt.cacheWriteTokens;
    const displayed = (await tokens.locator("dd").allTextContents())
      .filter((value) => value.endsWith(" tok"))
      .reduce((sum, value) => sum + Number(value.replace(/[^0-9]/g, "")), 0);
    assert.equal(displayed, total, "visible billing rows do not add up to total tokens");
    await page.screenshot({ path: path.join(root, "token-breakdown.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.getByTestId("session-statistics-trigger").click();
    await page.getByTestId("session-statistics-details").waitFor();
    assert.equal(
      await page
        .getByTestId("session-statistics-details")
        .locator("dt")
        .filter({ hasText: /^模型用时$/ })
        .locator("..")
        .locator("dd")
        .innerText(),
      "2分0秒",
    );
    await page.screenshot({
      path: path.join(root, "statistics-carry.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  });
  await checkCase("orphan-recovery", async () => {
    await fresh();
    const task = await send("只回复BEFORE_RECOVERY，不派工，不使用工具。");
    const done = await completed(task.id);
    const interruptedAt = new Date().toISOString();
    done.status = "running";
    done.lead.status = "running";
    done.updatedAt = interruptedAt;
    done.events.push({
      seq: done.events.at(-1).seq + 1,
      at: interruptedAt,
      role: "user",
      kind: "message",
      text: "模拟宿主失联边界，不自动重跑",
    });
    const receipts = JSON.stringify(done.usage);
    await fs.writeFile(path.join(root, `data/tasks/${task.id}.json`), JSON.stringify(done));
    await page.reload();
    await page
      .locator('[data-testid="two-code-state"][data-status="error"]')
      .waitFor({ timeout: 15000 });
    await page
      .getByRole("alert")
      .filter({ hasText: /上次运行未正常结束/ })
      .waitFor();
    const recovered = await read(task.id);
    assert.equal(JSON.stringify(recovered.usage), receipts, "recovery called a model");
    assert.equal(recovered.lead.sessionId, done.lead.sessionId);
    assert.equal(recovered.events.at(-1).kind, "error");
    assert.equal(recovered.events.at(-1).at, interruptedAt);
    await send("上一轮不再执行。只回复RECOVERED_OK，不派工，不使用工具。", task.id);
    const resumed = await completed(task.id);
    assert.match(resumed.lead.lastReport, /RECOVERED_OK/);
    assert.equal(resumed.lead.sessionId, done.lead.sessionId);
  });
}
