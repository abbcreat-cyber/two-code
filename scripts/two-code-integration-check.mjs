import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/qa/integration-${Date.now()}`;
const workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(path.join(root, "data/tasks"), { recursive: true });
const preferences = JSON.parse(await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"));
preferences.mode = "build";
await fs.writeFile(path.join(root, "data/preferences.json"), JSON.stringify(preferences));
const legacyId = randomUUID(),
  at = new Date().toISOString();
await fs.writeFile(
  path.join(root, `data/tasks/${legacyId}.json`),
  JSON.stringify({
    id: legacyId,
    workspacePath: workspace,
    title: "旧任务迁移检查",
    dual: true,
    status: "completed",
    lead: { selection: preferences.lead, status: "completed" },
    sidekick: { selection: preferences.sidekick, status: "idle" },
    events: [
      { seq: 1, at, role: "user", kind: "message", text: "旧任务迁移检查" },
      { seq: 2, at, role: "lead", kind: "message", text: "**历史记录**应显示在原生聊天中。" },
    ],
    permissions: [],
    requestIds: [],
    updatedAt: at,
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: path.join(root, "data"),
  ZCODE_DATA_BASE_DIR: path.join(root, "data"),
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code Integration QA",
};
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.TWO_CODE_QA_EXE;
const app = await electron.launch({
  executablePath: executable || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(executable ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  const configureRole = async (role, changes) => {
    const label = role === "lead" ? "主手" : "副手";
    await page.getByTestId(`two-code-${role}-model`).click();
    await page
      .getByTestId(`two-code-${role}-panel`)
      .getByRole("button", { name: "管理模型与连接…" })
      .click();
    const dialog = page.getByRole("dialog", { name: `${label} · 模型与连接` });
    await dialog.locator("summary").click();
    if (changes.harness)
      await dialog.getByLabel(`${label}脚手架`, { exact: true }).selectOption(changes.harness);
    if (changes.provider)
      await dialog.getByLabel(`${label}提供方`, { exact: true }).fill(changes.provider);
    if (changes.model) await dialog.getByLabel(`${label}模型`, { exact: true }).fill(changes.model);
    if (changes.thinking)
      await dialog.getByLabel(`${label}思考`, { exact: true }).selectOption(changes.thinking);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 30000 });
  await page.getByTestId("two-code-lead-model").waitFor({ state: "visible", timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isFocusable() || win.getBounds().x > -1000) throw new Error("QA isolation failed");
    win.showInactive();
  });
  await page.waitForTimeout(2000);
  assert.equal(await page.getByTestId("two-code-sidebar-open").count(), 0);
  assert.equal(await page.getByTestId("two-code-workbench").count(), 0);
  console.log(JSON.stringify({ root, errors }));
  await page.screenshot({ animations: "disabled", path: path.join(root, "initial.png") });
  // 实际原生testid在不同版本可能使用不同分隔符，按任务地址严格定位同一个原生行。
  const nativeRow = page.locator(`[data-testid*="task-item"][data-testid$="${legacyId}"]`);
  await nativeRow.waitFor({ state: "visible", timeout: 30000 });
  await nativeRow.click();
  await page.getByText("历史记录", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByTestId("two-code-lead-model").isEnabled(), true);
  assert.equal(await page.getByTestId("two-code-sidekick-model").isEnabled(), true);
  await page.locator('[data-testid="chat-mode-select-trigger"]').click();
  for (const label of ["计划模式", "变更前确认", "自动编辑", "完全访问"])
    await page.getByRole("option", { name: new RegExp(label) }).waitFor();
  await page.screenshot({ animations: "disabled", path: path.join(root, "mode-menu.png") });
  await page.getByRole("option", { name: /自动编辑/ }).click();
  await configureRole("lead", { model: "sonnet" });
  await configureRole("sidekick", { thinking: "medium" });
  assert.match(await page.getByTestId("two-code-lead-model").innerText(), /DeepSeek V4.1 Flash/);
  const configuredLegacy = JSON.parse(
    await fs.readFile(path.join(root, `data/tasks/${legacyId}.json`), "utf8"),
  );
  assert.equal(configuredLegacy.lead.selection.model, "sonnet");
  assert.equal(configuredLegacy.sidekick.selection.thinking, "medium");
  assert.equal(configuredLegacy.mode, "edit");
  assert.equal((await page.locator("strong").filter({ hasText: "历史记录" }).count()) > 0, true);
  await page.screenshot({ animations: "disabled", path: path.join(root, "history.png") });
  await nativeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名任务", exact: true }).click();
  await page.getByPlaceholder("任务名称", { exact: true }).fill("原生重命名验收");
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await nativeRow
    .getByText("原生重命名验收", { exact: true })
    .waitFor({ state: "visible", timeout: 10000 });
  await nativeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "置顶任务", exact: true }).click();
  await page.getByText("已置顶", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.reload();
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 30000 });
  await nativeRow
    .getByText("原生重命名验收", { exact: true })
    .waitFor({ state: "visible", timeout: 20000 });
  await nativeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "取消置顶任务", exact: true }).click();
  await nativeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "归档任务", exact: true }).click();
  await nativeRow.waitFor({ state: "hidden", timeout: 10000 });
  if (process.env.TWO_CODE_QA_LIVE === "1") {
    await page
      .getByRole("button", { name: /^新建任务/ })
      .first()
      .click();
    await page.getByTestId("two-code-lead-model").click();
    const leadPanel = page.getByTestId("two-code-lead-panel");
    await leadPanel.waitFor();
    assert.equal(await leadPanel.getByLabel("主手脚手架").inputValue(), "claude-code");
    await leadPanel.getByLabel("主手搜索模型").fill("DeepSeek");
    assert.equal(
      await leadPanel.getByRole("listbox", { name: "主手模型列表" }).getByRole("option").count(),
      1,
    );
    assert.equal(
      (
        await leadPanel
          .getByRole("listbox", { name: "主手模型列表" })
          .getByRole("option")
          .innerText()
      ).trim(),
      "DeepSeek V4.1 Flash",
    );
    assert.equal(await leadPanel.getByText(/其他脚手架/).count(), 0);
    assert.equal(await leadPanel.getByRole("combobox", { name: "主手思考档位" }).count(), 1);
    await page.screenshot({ animations: "disabled", path: path.join(root, "lead-panel.png") });
    await leadPanel.getByRole("button", { name: "管理模型与连接…" }).click();
    const roleDialog = page.getByRole("dialog", { name: "主手 · 模型与连接" });
    await roleDialog.waitFor();
    assert.equal(await roleDialog.getByLabel("副手模型", { exact: true }).count(), 0);
    await roleDialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByTestId("two-code-sidekick-model").click();
    const childPanel = page.getByTestId("two-code-sidekick-panel");
    await childPanel.getByLabel("副手思考档位", { exact: true }).selectOption("medium");
    await page.waitForTimeout(200);
    const childBounds = await childPanel.boundingBox();
    assert(
      childBounds.y >= 0 &&
        childBounds.y + childBounds.height <= (await page.evaluate(() => innerHeight)),
      "role panel clipped by viewport",
    );
    await page.screenshot({ animations: "disabled", path: path.join(root, "sidekick-panel.png") });
    await page.keyboard.press("Escape");
    await page.getByTestId("two-code-mode").click();
    const collaboration = page.getByTestId("two-code-collaboration-panel");
    assert.equal(
      await collaboration.getByRole("button", { name: /组合设置|主副手配置/ }).count(),
      0,
    );
    await collaboration.getByRole("button", { name: "单角色", exact: true }).click();
    await page.getByTestId("two-code-sidekick-model").waitFor({ state: "hidden" });
    await collaboration.getByRole("button", { name: "双角色", exact: true }).click();
    await page.getByTestId("two-code-sidekick-model").waitFor({ state: "visible" });
    await page.screenshot({
      animations: "disabled",
      path: path.join(root, "collaboration-menu.png"),
    });
    await collaboration.getByRole("button", { name: "将当前配置设为默认", exact: true }).click();
    await page.getByText("已保存，以后新建任务使用此配置", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const roleBounds = await page.getByTestId("two-code-sidekick-model").boundingBox();
    const sendBounds = await page.getByTestId("two-code-send").boundingBox();
    assert(roleBounds.x + roleBounds.width <= sendBounds.x, "model controls overlap send button");
    const prompt =
      "原生界面实测。主手先用Write工具在当前目录创建integration-proof.txt，内容恰为INTEGRATED_OK。然后必须派给持久副手心算17乘19，副手只报告答案。主手核对后回复Markdown粗体的323。暗号青松仅记在会话上下文，不写记忆文件。本任务只允许Write/Read这个测试文件以及sidekick/read_sidekick。禁止Bash、Shell、其他文件操作、GUI、联网和加载技能。";
    await page.getByTestId("two-code-composer").fill(prompt);
    await page.getByTestId("two-code-send").click();
    await page.getByTestId("two-code-permission").waitFor({ state: "visible", timeout: 90000 });
    await page.screenshot({ animations: "disabled", path: path.join(root, "permission.png") });
    const deadline = Date.now() + 150000;
    while ((await page.getByTestId("two-code-state").getAttribute("data-status")) === "running") {
      if (Date.now() > deadline) throw new Error("Live integrated task timed out");
      const permission = page.getByTestId("two-code-permission");
      if (await permission.count()) {
        const raw = (await permission.innerText()).match(/\{[\s\S]*?\}/)?.[0];
        const args = raw ? JSON.parse(raw) : {};
        const allow =
          ["Write", "Read"].includes(await permission.getAttribute("data-tool")) &&
          typeof args.file_path === "string" &&
          path.resolve(workspace, args.file_path) ===
            path.resolve(workspace, "integration-proof.txt");
        await permission
          .getByRole("option", { name: allow ? "允许本次" : "拒绝", exact: true })
          .focus();
        await permission.getByRole("button", { name: "确认", exact: true }).click();
      }
      await page.waitForTimeout(300);
    }
    assert.equal(await page.getByTestId("two-code-state").getAttribute("data-status"), "completed");
    assert.equal(
      await fs.readFile(path.join(workspace, "integration-proof.txt"), "utf8"),
      "INTEGRATED_OK",
    );
    const files = (await fs.readdir(path.join(root, "data/tasks"))).filter(
      (f) => f.endsWith(".json") && f !== `${legacyId}.json`,
    );
    assert.equal(files.length, 1);
    const taskPath = path.join(root, "data/tasks", files[0]);
    const first = JSON.parse(await fs.readFile(taskPath, "utf8"));
    assert.equal(first.sidekick.status, "completed");
    assert(first.events.some((e) => e.role === "lead" && e.kind === "reasoning" && e.text));
    const nativeChildRecords = (await fs.readFile(first.sidekick.sessionId, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const nativeChildThought = nativeChildRecords
      .flatMap((r) => (r.message?.role === "assistant" ? (r.message.content ?? []) : []))
      .filter((b) => b.type === "thinking")
      .map((b) => b.thinking || "")
      .join("");
    const projectedChildThought = first.events
      .filter((e) => e.role === "sidekick" && e.kind === "reasoning")
      .map((e) => e.text)
      .join("");
    assert.equal(
      projectedChildThought,
      nativeChildThought,
      "Pi thought stream must match its native transcript, including no-thought replies",
    );
    const workToggle = page.locator('[data-testid^="chat-assistant-history-trigger"]').first();
    await workToggle.click();
    await page.getByTestId("chat-reasoning-trigger").first().click();
    const thoughtContent = page.getByTestId("chat-reasoning-content").first();
    await thoughtContent.waitFor({ state: "visible" });
    const firstThought = first.events.find(
      (e) => e.role === "lead" && e.kind === "reasoning" && e.text,
    );
    assert((await thoughtContent.innerText()).includes(firstThought.text));
    await page.screenshot({
      animations: "disabled",
      path: path.join(root, "native-reasoning.png"),
    });
    await workToggle.click();
    assert(first.usage.some((u) => u.role === "lead" && u.outputTokens > 0));
    assert(first.usage.some((u) => u.role === "sidekick" && u.outputTokens > 0));
    await page.getByTestId("session-statistics-trigger").click();
    await page.getByTestId("session-statistics-details").waitFor();
    await page.screenshot({
      animations: "disabled",
      path: path.join(root, "statistics-details.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByTestId("session-statistics-details").waitFor({ state: "hidden" });
    await page.getByTestId("session-token-usage-trigger").click();
    await page.getByTestId("session-token-usage-details").waitFor();
    const totalTokens = first.usage.reduce(
      (sum, u) => sum + u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens,
      0,
    );
    assert(
      (await page.getByTestId("session-token-usage-details").innerText()).includes(
        new Intl.NumberFormat("zh-CN").format(totalTokens),
      ),
    );
    await page.screenshot({ animations: "disabled", path: path.join(root, "token-details.png") });
    await page.keyboard.press("Escape");
    await page.getByTestId("session-token-usage-details").waitFor({ state: "hidden" });
    const liveRow = page.locator(`[data-testid*="task-item"][data-testid$="${first.id}"]`);
    await liveRow.waitFor({ state: "visible", timeout: 15000 });
    assert.equal((await page.locator("strong").filter({ hasText: "323" }).count()) > 0, true);
    await page.screenshot({ animations: "disabled", path: path.join(root, "live.png") });
    await page.reload();
    await liveRow.waitFor({ state: "visible", timeout: 20000 });
    await liveRow.click();
    const beforeReloadUsage = JSON.parse(await fs.readFile(taskPath, "utf8")).usage;
    assert.deepEqual(beforeReloadUsage, first.usage);
    await configureRole("lead", { model: "sonnet" });
    await configureRole("sidekick", { thinking: "medium" });
    await page
      .getByTestId("two-code-composer")
      .fill("请再次交给同一副手，让它复述上次计算结果。主手再告诉我暗号。不用任何其他工具。");
    await page.getByTestId("two-code-send").click();
    await page
      .locator('[data-testid="two-code-state"][data-status="running"]')
      .waitFor({ timeout: 20000 });
    await page
      .locator('[data-testid="two-code-state"][data-status="completed"]')
      .waitFor({ timeout: 150000 });
    const second = JSON.parse(await fs.readFile(taskPath, "utf8"));
    assert.equal(first.lead.sessionId, second.lead.sessionId);
    assert.equal(first.sidekick.sessionId, second.sidekick.sessionId);
    assert.equal(second.lead.selection.model, "sonnet");
    assert.equal(second.sidekick.selection.thinking, "medium");
    assert(second.usage.length > first.usage.length);
    assert.match(second.lead.lastReport, /青松/);
    assert.match(second.sidekick.lastReport, /323/);
    await page
      .getByRole("button", { name: /^新建任务/ })
      .first()
      .click();
    await configureRole("lead", {
      harness: "pi",
      provider: "ds-tencent",
      model: preferences.sidekick.model,
      thinking: "high",
    });
    await configureRole("sidekick", {
      harness: "claude-code",
      model: preferences.lead.model,
      thinking: "high",
    });
    await page
      .getByTestId("two-code-composer")
      .fill(
        "反向组合验收：必须派给持久副手心算12乘13。副手报告答案后主手核对，最后回复Markdown粗体156。不调用其他工具、不加载技能、不写文件。",
      );
    await page.getByTestId("two-code-send").click();
    await page
      .locator('[data-testid="two-code-state"][data-status="running"]')
      .waitFor({ timeout: 20000 });
    await page
      .locator('[data-testid="two-code-state"][data-status="completed"]')
      .waitFor({ timeout: 150000 });
    const reverseFiles = (await fs.readdir(path.join(root, "data/tasks"))).filter(
      (f) => f.endsWith(".json") && f !== `${legacyId}.json` && f !== files[0],
    );
    assert.equal(reverseFiles.length, 1);
    const reverse = JSON.parse(
      await fs.readFile(path.join(root, "data/tasks", reverseFiles[0]), "utf8"),
    );
    assert.equal(reverse.lead.selection.harness, "pi");
    assert.equal(reverse.sidekick.selection.harness, "claude-code");
    assert.equal(reverse.sidekick.status, "completed");
    assert.match(reverse.sidekick.lastReport, /156/);
    await page.screenshot({ animations: "disabled", path: path.join(root, "reverse.png") });
    await page
      .getByRole("button", { name: /^新建任务/ })
      .first()
      .click();
    await page
      .getByTestId("two-code-composer")
      .fill("停止按钮验收，先等候主手安排，不使用任何工具。");
    await page.getByTestId("two-code-send").click();
    await page.getByTestId("two-code-stop").click({ timeout: 10000 });
    await page
      .locator('[data-testid="two-code-state"][data-status="cancelled"]')
      .waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ liveIntegrated: true, sameSessions: true, root }));
  }
  await fs.writeFile(
    path.join(root, "observation.json"),
    JSON.stringify(
      { root, legacyId, errors, text: await page.locator("body").innerText() },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({ nativeTaskList: true, nativeMarkdown: true, root }));
} catch (error) {
  const page = (await app.windows())[0];
  if (page) {
    await page
      .screenshot({ animations: "disabled", path: path.join(root, "failure.png") })
      .catch(() => {});
    await fs.writeFile(
      path.join(root, "failure.txt"),
      (await page.locator("body").innerText()).slice(0, 10000),
    );
  }
  throw error;
} finally {
  await app.close();
}
