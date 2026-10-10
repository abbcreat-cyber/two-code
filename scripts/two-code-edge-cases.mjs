import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export async function runEdgeCases({
  page,
  root,
  workspace,
  tasks,
  read,
  send,
  fresh,
  completed,
  until,
  checkCase,
}) {
  const mode = async (name) => {
    await page.getByTestId("chat-mode-select-trigger").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
  };
  await checkCase("history-ui", async () => {
    const stopped = (await tasks()).find(
      (task) =>
        task.status === "completed" &&
        task.events.some((e) => e.kind === "status" && e.text === "正在停止主手与副手"),
    );
    assert(stopped, "cancel-resume task is required");
    await page.locator(`[data-testid*="task-item"][data-testid$="${stopped.id}"]`).click();
    const tool = page.locator('[data-tool-name="sidekick"]').first();
    await tool.waitFor();
    assert.equal(await tool.getAttribute("data-status"), "stopped");
    await page.getByText("已停止", { exact: true }).first().waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(root, "cancel-resumed.png") });
  });
  await checkCase("failure-retry", async () => {
    await fresh();
    const file = path.join(root, "data/model-connections.json");
    const previous = await fs.readFile(file).catch(() => undefined);
    const prompt = "派副手只心算6+7，主手核对后只回复13。不使用其他工具。";
    let failedTask;
    try {
      await fs.writeFile(file, "{broken");
      await page.getByTestId("two-code-composer").fill(prompt);
      await page.getByTestId("two-code-send").click();
      await page
        .getByRole("alert")
        .filter({ hasText: /模型配置损坏/ })
        .waitFor({ timeout: 20000 });
      await until(
        async () => (await page.getByTestId("two-code-composer").innerText()) === prompt,
        5000,
      );
      const created = await tasks();
      failedTask = created.find((t) => t.status === "idle");
      assert(failedTask, "failed send did not preserve created task");
      assert.equal(failedTask.events.filter((e) => e.role === "user").length, 0);
      await page.screenshot({ animations: "disabled", path: path.join(root, "send-failed.png") });
    } finally {
      if (previous) await fs.writeFile(file, previous);
      else await fs.rm(file, { force: true });
    }
    const before = (await tasks()).length;
    await send(prompt, failedTask.id);
    const done = await completed(failedTask.id);
    assert.match(done.lead.lastReport, /13/);
    assert.equal((await tasks()).length, before, "retry duplicated task");
    assert.equal(done.events.filter((e) => e.role === "user").length, 1, "retry duplicated input");
    assert.equal(
      await page
        .getByRole("alert")
        .filter({ hasText: /模型配置损坏/ })
        .count(),
      0,
    );
    assert.equal(
      (await page.getByTestId("two-code-composer").innerText()).trim(),
      "",
      "successful retry retained sent draft",
    );
  });
  await checkCase("stream-switch", async () => {
    await fresh();
    await mode("计划模式");
    const task = await send(
      "主手先说FLOW_ORIGIN_7049，然后派副手只心算17乘23，报告后主手只给结果391。不使用其他工具。",
    );
    await until(async () => (await read(task.id)).sidekick.status === "running", 60000);
    await fresh();
    await page.getByTestId("two-code-composer").fill("另一个任务的未发送草稿");
    await completed(task.id);
    assert.equal(await page.getByTestId("two-code-composer").innerText(), "另一个任务的未发送草稿");
    assert.equal(await page.getByTestId("two-code-state").count(), 0);
    assert(
      !(await page.getByTestId("two-code-native-session").innerText()).includes("FLOW_ORIGIN_7049"),
      "background task streamed into draft view",
    );
    await page.locator(`[data-testid*="task-item"][data-testid$="${task.id}"]`).click();
    await page.getByText("391", { exact: true }).last().waitFor();
  });
  await checkCase("permission-stop", async () => {
    await fresh();
    await mode("变更前确认");
    const task = await send(
      "立即派副手调用write创建stop-wait.txt，内容NEVER_WRITE。权限确认由应用拦截工具调用并弹框处理，不要先用文字请示，不要使用其他工具。",
    );
    await page.getByTestId("two-code-permission").waitFor({ timeout: 60000 });
    await page.getByTestId("two-code-stop").click({ timeout: 10000 });
    await page
      .locator('[data-testid="two-code-state"][data-status="cancelled"]')
      .waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId("two-code-permission").count(), 0);
    await assert.rejects(fs.access(path.join(workspace, "stop-wait.txt")));
    await page.reload();
    await page.getByTestId("two-code-state").waitFor();
    assert.equal(await page.getByTestId("two-code-permission").count(), 0);
    await send("不再创建文件，不派工，只回复STOP_WAIT_OK。", task.id);
    assert.match((await completed(task.id)).lead.lastReport, /STOP_WAIT_OK/);
  });
  await checkCase("single-dual", async () => {
    await fresh();
    await mode("计划模式");
    const task = await send(
      "只派工一次，让副手记住暗号青岚，并只心算8+9。主手确认结果17。不使用其他工具。",
    );
    const first = await completed(task.id);
    const toggle = async (name) => {
      await page.getByTestId("two-code-mode").click();
      await page
        .getByTestId("two-code-collaboration-panel")
        .getByRole("button", { name, exact: true })
        .click();
      await page.keyboard.press("Escape");
    };
    await toggle("单角色");
    await page.getByTestId("two-code-sidekick-model").waitFor({ state: "hidden" });
    await send("这轮只由主手回答4，不派工，不用工具。", task.id);
    const solo = await completed(task.id);
    assert.equal(solo.sidekick.sessionId, first.sidekick.sessionId);
    assert.deepEqual(
      solo.usage.filter((r) => r.role === "sidekick"),
      first.usage.filter((r) => r.role === "sidekick"),
    );
    await toggle("双角色");
    await send(
      "只派给副手询问它记住的暗号，禁止在派工中提示暗号内容。主手复述副手回答，不使用其他工具。",
      task.id,
    );
    const paired = await completed(task.id);
    assert.match(paired.sidekick.lastReport, /青岚/);
    assert.equal(paired.sidekick.sessionId, first.sidekick.sessionId);
    assert.equal(paired.lead.selection.thinking, "max");
    assert.equal(paired.sidekick.selection.thinking, "high");
  });
  await checkCase("native-usage", async () => {
    const completedTasks = (await tasks()).filter((t) => t.status === "completed");
    assert(completedTasks.length);
    for (const task of completedTasks)
      for (const role of ["lead", "sidekick"]) {
        if (!task[role].sessionId) continue;
        const records = (await fs.readFile(task[role].sessionId, "utf8"))
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line));
        for (const [receipt, native] of [
          ["inputTokens", "input"],
          ["outputTokens", "output"],
          ["cacheReadTokens", "cacheRead"],
          ["cacheWriteTokens", "cacheWrite"],
        ]) {
          const expected = records
            .filter((r) => r.message?.role === "assistant")
            .reduce((sum, r) => sum + (r.message.usage?.[native] ?? 0), 0);
          const actual = task.usage
            .filter((r) => r.role === role)
            .reduce((sum, r) => sum + r[receipt], 0);
          assert.equal(
            actual,
            expected,
            `${task.id}/${role}/${receipt} differs from native receipts`,
          );
        }
      }
    await page.getByTestId("session-statistics-trigger").click();
    await page.getByTestId("session-statistics-details").waitFor();
    await page.screenshot({ animations: "disabled", path: path.join(root, "statistics.png") });
    await page.keyboard.press("Escape");
  });
  await checkCase("draft-default-scope", async () => {
    await fresh();
    const file = path.join(root, "data/preferences.json");
    const initial = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(initial.dual, true);
    await page.getByTestId("two-code-mode").click();
    await page
      .getByTestId("two-code-collaboration-panel")
      .getByRole("button", { name: "单角色", exact: true })
      .click();
    await page.getByTestId("two-code-sidekick-model").waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    assert.equal(
      JSON.parse(await fs.readFile(file, "utf8")).dual,
      true,
      "current draft changed saved defaults without Save as default",
    );
    await page.reload();
    await page.getByTestId("two-code-lead-model").waitFor();
    await page.getByTestId("two-code-sidekick-model").waitFor({ state: "hidden" });
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).dual, true);
    const task = await send("只回复SCOPED_OK，不使用工具。");
    assert.match((await completed(task.id)).lead.lastReport, /SCOPED_OK/);
    assert.equal(
      JSON.parse(await fs.readFile(file, "utf8")).dual,
      true,
      "sending draft overwrote defaults",
    );
    await fresh();
    await page.getByTestId("two-code-sidekick-model").waitFor();
    await page.getByTestId("two-code-mode").click();
    const panel = page.getByTestId("two-code-collaboration-panel");
    await panel.getByRole("button", { name: "单角色", exact: true }).click();
    await panel.getByRole("button", { name: "将当前配置设为默认", exact: true }).click();
    await panel.getByText("已保存，以后新建任务使用此配置", { exact: true }).waitFor();
    assert.equal(
      JSON.parse(await fs.readFile(file, "utf8")).dual,
      false,
      "explicit Save as default did not persist",
    );
    await page.keyboard.press("Escape");
  });
}
