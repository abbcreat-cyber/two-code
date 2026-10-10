import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/qa/desktop-${Date.now()}`;
await fs.mkdir(path.join(root, "data"), { recursive: true });
await fs.mkdir(path.join(root, "workspace"), { recursive: true });
await fs.copyFile(
  "D:/Apps/TwoCode/data/preferences.json",
  path.join(root, "data/preferences.json"),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: path.join(root, "data"),
  ZCODE_DATA_BASE_DIR: path.join(root, "data"),
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code QA",
  NODE_ENV: "production",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath:
    process.env.TWO_CODE_QA_EXE || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [
    ...(process.env.TWO_CODE_QA_EXE ? [] : [path.join(repo, "packages/desktop")]),
    "--disable-gpu",
  ],
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow({ timeout: 60000 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  console.log(
    JSON.stringify({
      url: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 4500),
    }),
  );
  const identity = await app.evaluate(({ app, BrowserWindow }) => ({
    name: app.getName(),
    userData: app.getPath("userData"),
    windows: BrowserWindow.getAllWindows().map((win) => ({
      title: win.getTitle(),
      visible: win.isVisible(),
      bounds: win.getBounds(),
    })),
  }));
  await fs.writeFile(path.join(root, "identity.json"), JSON.stringify(identity, null, 2));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.getBounds().x > -1000 || win.isFocusable())
      throw new Error("QA窗口隔离条件不满足");
    win.showInactive();
  });
  await page.getByTestId("two-code-workbench").waitFor({ state: "visible", timeout: 30000 });
  if (await page.getByTestId("two-code-local-entry").count())
    throw new Error("首次启动仍被账号页拦截");
  assert.equal(
    await page.getByLabel("主手模型", { exact: true }).inputValue(),
    "claude-sonnet-4-8",
  );
  assert.equal(await page.getByLabel("副手提供方", { exact: true }).inputValue(), "ds-tencent");
  await page.screenshot({ path: path.join(root, "initial.png") });
  const entry = page.getByTestId("two-code-sidebar-open");
  if (await entry.count()) {
    await entry.click({ force: true });
    await page.getByTestId("two-code-workbench").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(root, "workbench.png") });
    console.log(
      JSON.stringify({
        workbench: await page.getByTestId("two-code-workbench").innerText(),
        errors,
      }),
    );
  }
  if (process.env.TWO_CODE_QA_LIVE === "1") {
    const workbench = page.getByTestId("two-code-workbench");
    await page
      .getByLabel("任务内容", { exact: true })
      .fill(
        "本次UI验收：主手先用Write工具在当前工作目录创建ui-proof.txt，内容恰为UI_OK，不要用Bash替代。然后必须调用sidekick让副手心算17乘19，不调用其他工具。主手核对323后用中文简短报告。不要联网、不要加载技能、不要操作GUI。记住验收暗号青松。后续仍要交给同一副手。",
      );
    await workbench.getByRole("button", { name: "开始", exact: true }).click();
    const permission = workbench.locator(".two-code-permissions");
    await permission.waitFor({ state: "visible", timeout: 90000 });
    assert.match(await permission.innerText(), /Write/);
    const args = JSON.parse(await permission.locator("pre").textContent());
    assert.equal(
      path.resolve(args.file_path),
      path.resolve(root, "data/.zcode/workspace/default/ui-proof.txt"),
    );
    await permission.getByRole("button", { name: "允许本次", exact: true }).click();
    await workbench
      .locator(".two-code-conversation-bar")
      .getByText("已结束", { exact: true })
      .waitFor({ timeout: 120000 });
    assert.equal(await fs.readFile(args.file_path, "utf8"), "UI_OK");
    const names = (await fs.readdir(path.join(root, "data/tasks"))).filter((n) =>
      n.endsWith(".json"),
    );
    assert.equal(names.length, 1);
    const taskFile = path.join(root, "data/tasks", names[0]);
    const first = JSON.parse(await fs.readFile(taskFile, "utf8"));
    assert.equal(first.sidekick.status, "completed");
    assert(first.events.some((event) => event.kind === "handoff"));
    await page.screenshot({ path: path.join(root, "task-completed.png") });
    await page.reload();
    await page.getByTestId("two-code-workbench").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".two-code-history button").first().click();
    await page
      .getByLabel("任务内容", { exact: true })
      .fill(
        "继续验收：必须交给同一副手，不调用其他工具，让它复述上次乘法结果。主手再报告暗号。不读取文件。",
      );
    await workbench.getByRole("button", { name: "继续", exact: true }).click();
    await workbench
      .locator(".two-code-conversation-bar")
      .getByText("已结束", { exact: true })
      .waitFor({ timeout: 120000 });
    const second = JSON.parse(await fs.readFile(taskFile, "utf8"));
    assert.equal(first.lead.sessionId, second.lead.sessionId);
    assert.equal(first.sidekick.sessionId, second.sidekick.sessionId);
    assert.match(second.lead.lastReport, /青松/);
    assert.match(second.sidekick.lastReport, /323/);
    await workbench.getByRole("button", { name: "新任务", exact: true }).click();
    await page.getByLabel("主手脚手架", { exact: true }).selectOption("pi");
    await page.getByLabel("主手提供方", { exact: true }).fill("ds-tencent");
    await page.getByLabel("副手脚手架", { exact: true }).selectOption("claude-code");
    assert.equal(await page.getByLabel("副手模型", { exact: true }).isEnabled(), true);
    await workbench.getByRole("button", { name: "单角色对照", exact: true }).click();
    assert.equal(await page.getByLabel("副手配置", { exact: true }).count(), 0);
    await workbench.getByRole("button", { name: "双角色", exact: true }).click();
    console.log(
      JSON.stringify({
        liveUI: true,
        permission: true,
        artifact: true,
        restoredSameSessions: true,
        roleSwitch: true,
        root,
      }),
    );
  }
  await fs.writeFile(
    path.join(root, "ui-observation.json"),
    JSON.stringify({ identity, errors, text: await page.locator("body").innerText() }, null, 2),
  );
} finally {
  await app.close();
}
