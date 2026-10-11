import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const root = `D:/Apps/TwoCode/qa/frontend-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(`${cwd}/界面夹具.txt`, "UI_FILE_7319");
await fs.writeFile(
  `${cwd}/blocked.mjs`,
  "import fs from 'node:fs';fs.writeFileSync(new URL('unexpected.txt',import.meta.url),'BAD');",
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
const service = services.get(ITwoCodeService);
const model = (await service.catalog())
  .find((h) => h.id === "claude-code")
  ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
assert(model);
const task = await service.create({
  workspacePath: cwd,
  title: "界面适配验收",
  dual: true,
  mode: "edit",
  lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
  sidekick: { harness: "claude-code", provider: model.provider, model: model.id, thinking: "high" },
});
task.status = "completed";
task.lead.status = "completed";
task.events = [
  { seq: 1, at: new Date().toISOString(), role: "user", kind: "message", text: "历史回填标记" },
  { seq: 2, at: new Date().toISOString(), role: "lead", kind: "message", text: "这是展示夹具。" },
];
await services.get(IProviderSettingsService).getView();
await services.get(ISettingService).update({
  lastWorkspaceSession: [{ kind: "local", workspacePath: task.workspacePath }],
  lastActiveTabIndex: 0,
});
await disposeServiceResourcesAndWait(services);
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
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.13"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const results: Array<{ name: string; passed: boolean; error?: string }> = [],
  errors: string[] = [];
const page = await app.firstWindow();
page.on("pageerror", (e) => errors.push(e.message));
async function check(name: string, f: () => Promise<void>) {
  if (
    process.env.TWO_CODE_FRONTEND_CASES &&
    !process.env.TWO_CODE_FRONTEND_CASES.split(",").includes(name)
  )
    return;
  try {
    await f();
    results.push({ name, passed: true });
  } catch (e) {
    results.push({ name, passed: false, error: String(e) });
    await page.screenshot({ path: `${root}/${name}-failure.png` }).catch(() => {});
  }
  console.log(JSON.stringify(results.at(-1)));
}
const read = async () =>
  JSON.parse(await fs.readFile(`${root}/data/tasks/${task.id}.json`, "utf8"));
const payload = {
  type: "file",
  workspacePath: task.workspacePath,
  path: `${task.workspacePath}\\界面夹具.txt`,
  relativePath: "界面夹具.txt",
  name: "界面夹具.txt",
};
try {
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("isolation");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  await page
    .locator("[data-task-item-key], [data-grouped-task-key]")
    .filter({ hasText: task.title })
    .first()
    .click();
  const input = page.getByTestId("two-code-composer");
  await input.waitFor();
  await check("capability-menu", async () => {
    await input.fill("");
    await page.getByTestId("two-code-add-image").click();
    await page.getByText("添加图片", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("目标", { exact: true }).count(),
      0,
      "不支持的目标命令仍在菜单",
    );
    const menu = await page.locator('[data-slot="popover-content"]').innerText();
    assert(!menu.includes("添加上下文"), "关闭的@面板仍有提示");
    assert(!menu.includes("没有可引用的插件"), "未接入的插件分组不应显示");
    await page.screenshot({ path: `${root}/capability-menu.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.locator('[data-slot="popover-content"]').waitFor({ state: "detached" });
    await input.fill("/goal");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    assert.equal(
      await page.locator('[data-trigger="/"]').count(),
      0,
      "未接入的斜杠命令面板不应出现",
    );
    await input.fill("");
  });
  await page.keyboard.press("Escape");
  await check("file-menu", async () => {
    await page.locator('[data-testid^="workspace-item"]').first().hover();
    const files = page.locator('[data-testid^="workspace-file-tree-button"]').first();
    await files.click();
    const row = page
      .locator('[data-testid^="workspace-file-tree-row"]')
      .filter({ hasText: "界面夹具.txt" })
      .first();
    await row.waitFor({ timeout: 10000 });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "添加到聊天", exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="two-code-composer"]')
          ?.textContent?.includes("界面夹具.txt"),
      {},
      { timeout: 3000 },
    );
  });
  await page.keyboard.press("Escape");
  await check("file-drop", async () => {
    await input.fill("");
    await input.evaluate((el, p) => {
      const d = new DataTransfer();
      d.setData("application/x-zcode-workspace-file", JSON.stringify(p));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: d }));
    }, payload);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="two-code-composer"]')
          ?.textContent?.includes("界面夹具.txt"),
      {},
      { timeout: 3000 },
    );
  });
  await check("prompt-history", async () => {
    await input.fill("");
    await input.press("ArrowUp");
    assert.equal(await input.innerText(), "历史回填标记");
    await input.press("ArrowDown");
    assert.equal((await input.innerText()).trim(), "");
    await page.reload();
    await input.waitFor();
    await input.press("ArrowUp");
    assert.equal(await input.innerText(), "历史回填标记");
  });
  if (process.env.TWO_CODE_FRONTEND_LIVE === "1") {
    await check("real-file-reference", async () => {
      await input.fill(
        "让副手只读所附文件并报告其中的代码，主手读取副手报告后回答。禁止其他工具、联网、技能、命令。",
      );
      const handled = await page.evaluate(
        (p) =>
          !window.dispatchEvent(
            new CustomEvent("zcode:add-workspace-file-to-chat", { detail: p, cancelable: true }),
          ),
        payload,
      );
      assert(handled);
      await page.getByTestId("two-code-send").click();
      await page.locator('[data-testid="two-code-state"][data-status="running"]').waitFor();
      await page
        .locator('[data-testid="two-code-state"][data-status="completed"]')
        .waitFor({ timeout: 120000 });
      const done = await read();
      assert.match(done.lead.lastReport, /UI_FILE_7319/);
      assert(
        done.events.some(
          (e: { role: string; kind: string; text: string }) =>
            e.role === "sidekick" && e.kind === "tool" && e.text === "Read",
        ),
      );
      await fs.writeFile(`${root}/real-file.json`, JSON.stringify(done, null, 2));
    });
    await check("escape-stop", async () => {
      await input.fill(
        `让副手只用原生PowerShell执行一次 node '${cwd}/blocked.mjs'。不要其他工具，不读或改文件；主手等待。`,
      );
      await page.getByTestId("two-code-send").click();
      await page.getByTestId("two-code-permission").waitFor({ timeout: 90000 });
      await page.getByTestId("two-code-add-image").click();
      await page.getByText("添加图片", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator('[data-slot="popover-content"]').waitFor({ state: "detached" });
      assert.equal((await read()).status, "running", "关闭菜单不应停止任务");
      // 自动化指针仍悬在“+”上会重新弹出tooltip；先回到输入区，隔离关闭提示与停止任务。
      await input.click();
      await page.locator('[data-slot="tooltip-content"]').waitFor({ state: "detached" });
      await input.press("Escape");
      await page
        .locator('[data-testid="two-code-state"][data-status="cancelled"]')
        .waitFor({ timeout: 15000 });
      assert.equal(await page.getByTestId("two-code-permission").count(), 0);
      await assert.rejects(fs.access(`${cwd}/unexpected.txt`));
      await fs.writeFile(`${root}/cancelled.json`, JSON.stringify(await read(), null, 2));
    });
  }
  await page.screenshot({ path: `${root}/final.png`, animations: "disabled" });
} finally {
  await app.close();
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, results, errors }, null, 2));
  console.log(JSON.stringify({ root, results, errors }));
  if (results.some((r) => !r.passed) || errors.length) process.exitCode = 1;
}
