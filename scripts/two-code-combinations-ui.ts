import { verifyStepThinking, verifyResumedThinking } from "./two-code-thinking-ui.js";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { JsonPreferences } from "../packages/services/src/two-code/adapters/preferences.js";
const root = `D:/Apps/TwoCode/qa/combinations-ui-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.mkdir(cwd, { recursive: true });
const base = {
  dual: true,
  mode: "edit",
  lead: {
    harness: "step-code",
    provider: "step-plan",
    model: "step-5-preview",
    thinking: "medium",
  },
  sidekick: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
};
await fs.writeFile(`${root}/data/preferences.json`, JSON.stringify(base));
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, ISettingService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
await services.get(ITwoCodeService).catalog();
await services.get(IProviderSettingsService).getView();
await services.get(ISettingService).update({
  lastWorkspaceSession: [{ kind: "local", workspacePath: await fs.realpath(cwd) }],
  lastActiveTabIndex: 0,
});
await disposeServiceResourcesAndWait(services);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.16"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const page = await app.firstWindow(),
  errors: string[] = [],
  checks: string[] = [];
let passed = false;
const store = new JsonPreferences(`${root}/data`);
const panel = page.getByTestId("two-code-collaboration-panel");
const open = async () => {
  if (!(await panel.isVisible())) await page.getByTestId("two-code-mode").click();
  await page.getByTestId("two-code-combination-row").first().waitFor();
};
const close = async () => {
  if (await panel.isVisible()) {
    await page.getByTestId("two-code-mode").click();
    await panel.waitFor({ state: "detached" });
  }
};
const row = (name: string) =>
  page.getByTestId("two-code-combination-row").filter({ hasText: name });
const manage = async (name: string, action: string) => {
  await open();
  await row(name)
    .getByRole("button", { name: `管理${name}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
};
const nameAndSave = async (name: string) => {
  await page.getByTestId("two-code-combination-name").fill(name);
  await page.getByTestId("two-code-combination-confirm").click();
  await row(name).waitFor();
};
const use = async (name: string) => {
  await open();
  await row(name).locator('[data-testid^="two-code-combination-use-"]').click();
  await panel.waitFor({ state: "detached" });
};
try {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("isolation");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  await page.getByTestId("two-code-composer").fill("保留在输入框，不应自动发送。");
  await manage("默认组合", "重命名");
  await nameAndSave("日常协作");
  assert.equal(
    await page.getByTestId("two-code-composer").innerText(),
    "保留在输入框，不应自动发送。",
  );
  assert.equal(
    (await fs.readdir(`${root}/data/tasks`)).filter((n) => n.endsWith(".json")).length,
    0,
  );
  await close();
  await page.getByTestId("two-code-composer").fill("");
  await open();
  checks.push("save-does-not-submit-draft");
  checks.push("legacy-rename");
  await close();
  for (const role of ["lead", "sidekick"]) {
    await page.getByTestId(`two-code-${role}-model`).click();
    assert.equal(await page.getByTestId(`two-code-${role}-panel`).getByRole("textbox").count(), 0);
    await page
      .getByTestId(`two-code-${role}-panel`)
      .screenshot({ path: `${root}/${role}-no-search.png` });
    await page.getByTestId(`two-code-${role}-model`).click();
  }
  checks.push("model-search-removed");
  await verifyStepThinking(page, root);
  checks.push("step-thinking-three-levels");
  const unchangedLead = await page.getByTestId("two-code-lead-model").getAttribute("title");
  const unchangedSidekick = await page.getByTestId("two-code-sidekick-model").getAttribute("title");
  const unchangedDefault = await store.read();
  await page.getByTestId("two-code-composer").fill("自定义组合也不能发送这段草稿。");
  await open();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByRole("menu").screenshot({ path: `${root}/add-menu.png` });
  await page.getByTestId("two-code-combination-custom").click();
  await page.getByRole("combobox", { name: "自定义主手模型", exact: true }).click();
  assert.equal(await page.getByRole("option").filter({ hasText: "Step-5 API" }).count(), 1);
  assert.equal(await page.getByRole("option").filter({ hasText: "Step-5 订阅" }).count(), 1);
  await page.getByRole("listbox").screenshot({ path: `${root}/custom-models.png` });
  await page.getByRole("option").filter({ hasText: "Step-5 API" }).click();
  await page.getByRole("combobox", { name: "自定义主手思考档位", exact: true }).click();
  await page.getByRole("option", { name: "高", exact: true }).click();
  await page.getByRole("combobox", { name: "自定义副手模型", exact: true }).click();
  await page.getByRole("option", { name: "无", exact: true }).click();
  assert(
    await page.getByRole("combobox", { name: "自定义副手思考档位", exact: true }).isDisabled(),
  );
  await page.getByTestId("two-code-combination-name").fill("自定义单模型");
  await page.getByRole("combobox", { name: "自定义权限模式", exact: true }).click();
  await page.getByRole("option", { name: "计划模式", exact: true }).click();
  await panel.screenshot({ path: `${root}/custom-dark.png` });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 720));
  await panel.screenshot({ path: `${root}/custom-narrow.png` });
  await page.getByTestId("two-code-combination-name").press("Enter");
  await row("自定义单模型").waitFor();
  const customSaved = (await store.combinations()).items.find((c) => c.name === "自定义单模型")!;
  assert.equal(customSaved.preferences.dual, false);
  assert.equal(customSaved.preferences.mode, "plan");
  assert.equal(customSaved.preferences.lead.thinking, "high");
  assert.notEqual(customSaved.preferences.lead.provider, "step-plan");
  assert.deepEqual(await store.read(), unchangedDefault);
  assert.equal(await page.getByTestId("two-code-lead-model").getAttribute("title"), unchangedLead);
  assert.equal(
    await page.getByTestId("two-code-sidekick-model").getAttribute("title"),
    unchangedSidekick,
  );
  assert.equal(
    await page.getByTestId("two-code-composer").innerText(),
    "自定义组合也不能发送这段草稿。",
  );
  assert.equal(
    (await fs.readdir(`${root}/data/tasks`)).filter((n) => n.endsWith(".json")).length,
    0,
  );
  checks.push("custom-save-isolated-and-keyboard-submit");
  await manage("自定义单模型", "删除组合");
  await page.getByTestId("two-code-combination-confirm").click();
  await page.getByTestId("two-code-combination-add").waitFor();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-custom").click();
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await store.combinations()).items.length, 1);
  checks.push("custom-cancel-no-write");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1000));
  await close();
  await page.getByTestId("two-code-composer").fill("");
  await open();
  assert.equal(await page.getByText("ZCode 原生模式", { exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: /^(单角色|双角色)$/ }).count(), 0);
  await close();
  await page.getByTestId("two-code-sidekick-model").click();
  await page.getByTestId("two-code-sidekick-none").click();
  await page.getByTestId("two-code-sidekick-panel").waitFor({ state: "detached" });
  assert.equal(
    await page.getByTestId("two-code-sidekick-model").getAttribute("title"),
    "副手 · 无",
  );
  await open();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-save-current").click();
  await nameAndSave("快速处理");
  await close();
  await open();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-custom").click();
  await page.getByRole("combobox", { name: "自定义副手模型", exact: true }).click();
  await page
    .locator('[role="option"][data-model-id="claude-sonnet-4-8"][data-model-harness="claude-code"]')
    .click();
  await page.getByRole("combobox", { name: "自定义副手思考档位", exact: true }).click();
  await page.getByRole("option", { name: "低", exact: true }).click();
  await nameAndSave("轻量复核");
  assert.equal((await store.combinations()).items.length, 3);
  checks.push("create-three");
  await panel.screenshot({ path: `${root}/three-dark.png`, animations: "disabled" });
  await close();
  await use("快速处理");
  assert.equal(
    await page.getByTestId("two-code-sidekick-model").getAttribute("title"),
    "副手 · 无",
  );
  if (process.env.TWO_CODE_COMBINATIONS_LIVE === "1") {
    await page
      .getByTestId("two-code-composer")
      .fill("只回复SINGLE_OK，不用工具，不联网，不读写文件。");
    await page.getByTestId("two-code-send").click();
    await page.locator('[data-testid="two-code-state"][data-status="running"]').waitFor();
    await page
      .locator('[data-testid="two-code-state"][data-status="completed"]')
      .waitFor({ timeout: 120000 });
    const names = (await fs.readdir(`${root}/data/tasks`)).filter((n) => n.endsWith(".json"));
    assert.equal(names.length, 1);
    const single = JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"));
    assert.equal(single.dual, false);
    assert.equal(single.sidekick.sessionId, undefined);
    assert(!single.events.some((e: { role: string }) => e.role === "sidekick"));
    assert.match(single.lead.lastReport, /SINGLE_OK/);
    await fs.writeFile(`${root}/single-task.json`, JSON.stringify(single, null, 2));
    checks.push("real-single-no-sidekick");
    await page.getByTestId("conversation-new-task").click();
    await page.getByTestId("two-code-mode").waitFor();
  }
  await use("轻量复核");
  await page.getByTestId("two-code-sidekick-model").waitFor();
  assert.match(
    (await page.getByTestId("two-code-sidekick-model").getAttribute("title")) || "",
    /思考低/,
  );
  assert.equal((await store.combinations()).defaultId, "initial-default");
  checks.push("apply-without-changing-default");
  await manage("轻量复核", "设为默认");
  await panel.getByRole("status").waitFor();
  assert.equal((await store.read()).sidekick.thinking, "low");
  checks.push("default-selection");
  await manage("轻量复核", "重命名");
  await nameAndSave("轻量审阅");
  await close();
  await page.reload();
  await page.getByTestId("two-code-mode").waitFor();
  await open();
  await row("轻量审阅").waitFor();
  checks.push("rename-reload");
  await page.evaluate(() => localStorage.setItem("zcode-theme", "zai-light"));
  await page.reload();
  await page.getByTestId("two-code-mode").waitFor();
  await open();
  assert(await page.evaluate(() => document.documentElement.classList.contains("theme-zai-light")));
  await panel.screenshot({ path: `${root}/three-light.png`, animations: "disabled" });
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-custom").click();
  await panel.screenshot({ path: `${root}/custom-light.png`, animations: "disabled" });
  await page.evaluate(() => localStorage.setItem("zcode-theme", "zai-dark"));
  await page.reload();
  await page.getByTestId("two-code-mode").waitFor();
  await open();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 900));
  await panel.screenshot({ path: `${root}/three-narrow.png`, animations: "disabled" });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1000));
  await close();
  await use("日常协作");
  if (process.env.TWO_CODE_COMBINATIONS_LIVE === "1") {
    await page.getByTestId("two-code-lead-model").click();
    await page.getByRole("combobox", { name: "主手思考档位", exact: true }).click();
    await page.getByRole("option", { name: "低", exact: true }).click();
    await page.getByTestId("two-code-lead-model").click();
    await page
      .getByTestId("two-code-composer")
      .fill(
        "只让唯一副手回复PAIR_OK，主手读取副手报告后回复PAIR_OK。不调用其他工具，不联网，不改文件。",
      );
    await page.getByTestId("two-code-send").click();
    await page.locator('[data-testid="two-code-state"][data-status="running"]').waitFor();
    await page
      .locator('[data-testid="two-code-state"][data-status="completed"]')
      .waitFor({ timeout: 120000 });
    const names = (await fs.readdir(`${root}/data/tasks`)).filter((n) => n.endsWith(".json"));
    const all = await Promise.all(
      names.map(async (name) =>
        JSON.parse(await fs.readFile(`${root}/data/tasks/${name}`, "utf8")),
      ),
    );
    const task = all.find((t) => t.lead.lastReport?.includes("PAIR_OK"));
    assert(task);
    assert.equal(task.lead.selection.provider, "step-plan");
    assert.equal(task.lead.selection.thinking, "low");
    assert.equal(task.sidekick.selection.thinking, "high");
    assert.match(task.lead.lastReport, /PAIR_OK/);
    assert(task.events.some((e: { kind: string }) => e.kind === "handoff_report"));
    await fs.writeFile(`${root}/real-task.json`, JSON.stringify(task, null, 2));
    checks.push("real-pair");
    await verifyResumedThinking(page, root, task);
    checks.push("real-thinking-change-preserves-context");
    await page.getByTestId("conversation-new-task").click();
    await page.getByTestId("two-code-sidekick-model").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="two-code-sidekick-model"]')
        ?.getAttribute("title")
        ?.includes("思考低"),
    );
    checks.push("new-task-default");
  }
  let view = await store.combinations();
  while (view.items.length < 10)
    view = await store.saveCombination({
      revision: view.revision,
      name: `组合${view.items.length + 1}`,
      preferences: view.items[0]!.preferences,
    });
  await page.reload();
  await page.getByTestId("two-code-mode").waitFor();
  await open();
  assert.equal(await page.getByTestId("two-code-combination-count").innerText(), "10/10");
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-save-current").click();
  await page.getByTestId("two-code-combination-name").fill("第十一套");
  await page.getByTestId("two-code-combination-confirm").click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "已保存10套组合，请先删除多余的组合" })
    .waitFor();
  assert.equal(await page.getByTestId("two-code-combination-name").inputValue(), "第十一套");
  assert.equal((await store.combinations()).items.length, 10);
  await panel.screenshot({ path: `${root}/limit.png`, animations: "disabled" });
  checks.push("eleventh-rejected");
  await panel.getByRole("button", { name: "返回组合列表", exact: true }).click();
  await manage("组合10", "删除组合");
  await page.getByTestId("two-code-combination-confirm").click();
  await page.getByTestId("two-code-combination-add").waitFor();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-save-current").click();
  assert.equal(await page.getByTestId("two-code-combination-name").inputValue(), "第十一套");
  await page.getByTestId("two-code-combination-confirm").click();
  await row("第十一套").waitFor();
  assert.equal((await store.combinations()).items.length, 10);
  checks.push("delete-and-save-preserved-name");
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-custom").click();
  await page.getByRole("combobox", { name: "自定义副手模型", exact: true }).click();
  await page.getByRole("option", { name: "无", exact: true }).click();
  await page.getByTestId("two-code-combination-name").fill("保留自定义配置");
  await page.getByTestId("two-code-combination-confirm").click();
  await panel.getByRole("alert").filter({ hasText: "已保存10套组合" }).waitFor();
  await panel.getByRole("button", { name: "返回组合列表", exact: true }).click();
  await manage("组合9", "删除组合");
  await page.getByTestId("two-code-combination-confirm").click();
  await page.getByTestId("two-code-combination-add").click();
  await page.getByTestId("two-code-combination-custom").click();
  assert.equal(await page.getByTestId("two-code-combination-name").inputValue(), "保留自定义配置");
  assert.equal(
    await page.getByRole("combobox", { name: "自定义副手模型", exact: true }).innerText(),
    "无",
  );
  await page.getByTestId("two-code-combination-confirm").click();
  await row("保留自定义配置").waitFor();
  assert.equal(
    (await store.combinations()).items.find((c) => c.name === "保留自定义配置")?.preferences.dual,
    false,
  );
  checks.push("custom-limit-preserves-models-and-name");
  assert.deepEqual(errors, []);
  passed = true;
} catch (e) {
  console.log(String(e));
  await page.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  await fs.writeFile(`${root}/error.txt`, String(e));
} finally {
  await app.close();
  store.dispose();
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify({ root, passed, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ root, passed, checks, errors }));
  if (!passed) process.exitCode = 1;
}
