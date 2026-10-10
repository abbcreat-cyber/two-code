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
  console.log(
    JSON.stringify({
      root,
      initial: (await page.locator("body").innerText()).slice(0, 2300),
      errors,
    }),
  );
  await page.screenshot({ path: path.join(root, "initial.png") });
  // 实际原生testid在不同版本可能使用不同分隔符，按任务地址严格定位同一个原生行。
  const nativeRow = page.locator(`[data-testid*="task-item"][data-testid$="${legacyId}"]`);
  await nativeRow.waitFor({ state: "visible", timeout: 30000 });
  await nativeRow.click();
  await page.getByText("历史记录", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await page.locator("strong").filter({ hasText: "历史记录" }).count()) > 0, true);
  await page.screenshot({ path: path.join(root, "history.png") });
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
    await page.getByRole("menuitem", { name: "管理模型", exact: true }).click();
    await page.getByRole("dialog", { name: "模型与脚手架" }).waitFor();
    assert.equal(await page.getByLabel("主手脚手架", { exact: true }).inputValue(), "claude-code");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const prompt =
      "原生界面实测。主手先用Write工具在当前目录创建integration-proof.txt，内容恰为INTEGRATED_OK。然后必须派给持久副手心算17乘19，副手只报告答案。主手核对后回复Markdown粗体的323。暗号青松仅记在会话上下文，不写记忆文件。本任务只允许Write/Read这个测试文件以及sidekick/read_sidekick。禁止Bash、Shell、其他文件操作、GUI、联网和加载技能。";
    await page.getByTestId("two-code-composer").fill(prompt);
    await page.getByTestId("two-code-send").click();
    await page.getByTestId("two-code-permission").waitFor({ state: "visible", timeout: 90000 });
    await page.screenshot({ path: path.join(root, "permission.png") });
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
    const liveRow = page.locator(`[data-testid*="task-item"][data-testid$="${first.id}"]`);
    await liveRow.waitFor({ state: "visible", timeout: 15000 });
    assert.equal((await page.locator("strong").filter({ hasText: "323" }).count()) > 0, true);
    await page.screenshot({ path: path.join(root, "live.png") });
    await page.reload();
    await liveRow.waitFor({ state: "visible", timeout: 20000 });
    await liveRow.click();
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
    assert.match(second.lead.lastReport, /青松/);
    assert.match(second.sidekick.lastReport, /323/);
    await page
      .getByRole("button", { name: /^新建任务/ })
      .first()
      .click();
    await page.getByTestId("two-code-mode").click();
    await page.getByRole("button", { name: "模型与脚手架", exact: true }).click();
    await page.getByLabel("主手脚手架", { exact: true }).selectOption("pi");
    await page.getByLabel("主手提供方", { exact: true }).fill("ds-tencent");
    await page.getByLabel("主手思考", { exact: true }).selectOption("high");
    await page.getByLabel("副手脚手架", { exact: true }).selectOption("claude-code");
    await page.getByLabel("副手思考", { exact: true }).selectOption("high");
    await page.getByRole("button", { name: "保存", exact: true }).click();
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
    await page.screenshot({ path: path.join(root, "reverse.png") });
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
    console.log(
      JSON.stringify({
        liveIntegrated: true,
        nativePermission: true,
        originalSidebar: true,
        sameSessions: true,
        root,
      }),
    );
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
    await page.screenshot({ path: path.join(root, "failure.png") }).catch(() => {});
    await fs.writeFile(
      path.join(root, "failure.txt"),
      (await page.locator("body").innerText()).slice(0, 10000),
    );
  }
  throw error;
} finally {
  await app.close();
}
