import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

export async function configureRole(page, role, changes) {
  const label = role === "lead" ? "主手" : "副手";
  await page.getByTestId(`two-code-${role}-model`).click();
  const panel = page.getByTestId(`two-code-${role}-panel`);
  if (changes.harness) {
    await panel.getByRole("combobox", { name: `${label}脚手架` }).click();
    await page
      .getByRole("option", {
        name: { pi: "Pi", "claude-code": "Claude Code", zcode: "ZCode" }[changes.harness],
        exact: true,
      })
      .click();
  }
  if (changes.model) {
    const id = changes.model === "sonnet" ? "claude-sonnet-4-8" : changes.model;
    const selector = `[data-model-id=${JSON.stringify(id)}]${changes.provider ? `[data-model-provider=${JSON.stringify(changes.provider)}]` : ""}`;
    await panel.locator(selector).first().click();
    if (changes.thinking) await page.getByTestId(`two-code-${role}-model`).click();
  }
  if (changes.thinking) {
    await panel.getByRole("combobox", { name: `${label}思考档位` }).click();
    await page
      .getByRole("option", { name: { medium: "中", high: "高" }[changes.thinking], exact: true })
      .click();
  }
  if (await panel.isVisible()) await page.keyboard.press("Escape");
}

export async function checkModelSettings(page, root) {
  const settings = page.getByTestId("two-code-model-settings");
  await settings.waitFor({ state: "visible" });
  assert.equal(await page.getByRole("dialog", { name: "主手 · 模型与连接" }).count(), 0);
  assert.equal(
    await page.getByTestId("two-code-settings-claude-code").getAttribute("aria-selected"),
    "true",
  );
  const editor = page.getByTestId("two-code-connection-editor");
  await editor.waitFor();
  assert.equal(await editor.getByLabel("API 密钥", { exact: true }).inputValue(), "");
  await editor.getByRole("button", { name: "修改连接名称", exact: true }).click();
  assert.equal(
    await editor
      .getByLabel("连接名称", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await editor.getByLabel("连接名称", { exact: true }).fill("Claude Code · QA");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByText("已保存，下一轮任务生效", { exact: true }).waitFor();
  await editor.getByRole("heading", { name: /Claude Code · QA/ }).waitFor();
  await settings
    .getByRole("navigation", { name: "模型连接" })
    .getByRole("button", { name: /Claude Code · QA/ })
    .waitFor();
  await page.screenshot({ animations: "disabled", path: path.join(root, "settings-claude.png") });
  await page.getByTestId("two-code-settings-pi").click();
  await settings
    .getByRole("navigation", { name: "模型连接" })
    .getByRole("button", { name: /ds-tencent/ })
    .click();
  await editor.getByLabel("连接名称", { exact: true }).fill("Pi · QA");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByText("已保存，下一轮任务生效", { exact: true }).waitFor();
  if (process.env.TWO_CODE_QA_PROBE_LIVE === "1") {
    await editor.getByRole("button", { name: "测试连接", exact: true }).first().click();
    await editor.getByRole("button", { name: "已连通", exact: true }).waitFor({ timeout: 25000 });
  }
  await page.screenshot({ animations: "disabled", path: path.join(root, "settings-pi.png") });
  await settings.getByRole("button", { name: "新增连接", exact: true }).click();
  await editor.getByLabel("连接名称", { exact: true }).fill("UI 验收连接");
  await editor.getByLabel("API 地址", { exact: true }).fill("http://127.0.0.1:1/v1");
  await editor.getByLabel("API 密钥", { exact: true }).fill("qa-non-secret");
  await editor.getByLabel("模型 ID 1", { exact: true }).fill("ui-proof-model");
  await editor.getByLabel("模型名称 1", { exact: true }).fill("UI 验收模型");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByText("已保存，下一轮任务生效", { exact: true }).waitFor();
  assert.equal(await editor.getByLabel("API 密钥", { exact: true }).inputValue(), "");
  await editor.getByRole("button", { name: "测试连接", exact: true }).click();
  await editor.getByRole("button", { name: "无法连通", exact: true }).waitFor({ timeout: 25000 });
  await page.screenshot({ animations: "disabled", path: path.join(root, "connection-failed.png") });
  await page.getByTestId("settings-back-button").click();
  await page.getByTestId("two-code-sidekick-model").click();
  const panel = page.getByTestId("two-code-sidekick-panel");
  await panel.getByLabel("副手搜索模型").fill("UI 验收模型");
  await panel.getByRole("option", { name: "UI 验收模型", exact: true }).waitFor();
  await panel.getByRole("button", { name: "管理模型与连接…" }).click();
  await settings.waitFor({ state: "visible" });
  await page.reload();
  // 原生设置页是临时标签，重载会返回任务；重新打开后验证保存的数据。
  await page.getByTestId("two-code-sidekick-model").click();
  await panel.getByRole("button", { name: "管理模型与连接…" }).click();
  await settings.waitFor({ state: "visible" });
  await page.getByTestId("two-code-settings-pi").click();
  await settings
    .getByRole("navigation", { name: "模型连接" })
    .getByRole("button", { name: /UI 验收连接/ })
    .click();
  assert.equal(
    await editor.getByLabel("模型 ID 1", { exact: true }).inputValue(),
    "ui-proof-model",
  );
  await editor.getByLabel("模型名称 1", { exact: true }).fill("UI 已更新模型");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByText("已保存，下一轮任务生效", { exact: true }).waitFor();
  const saved = JSON.parse(
    await fs.readFile(path.join(root, "data/model-connections.json"), "utf8"),
  );
  assert.equal(saved.connections.find((c) => c.name === "UI 验收连接").apiKey, "qa-non-secret");
  await editor.getByRole("button", { name: "移除连接", exact: true }).click();
  await editor.getByRole("button", { name: "确认移除此连接", exact: true }).click();
  await settings
    .getByRole("navigation", { name: "模型连接" })
    .getByRole("button", { name: /UI 验收连接/ })
    .waitFor({ state: "hidden" });
  await page.getByTestId("two-code-settings-zcode").click();
  await page.locator('[data-model-provider-split-panel="true"]').waitFor({ state: "visible" });
  await page.screenshot({ animations: "disabled", path: path.join(root, "settings-zcode.png") });
  await page.getByTestId("settings-back-button").click();
  console.log(
    JSON.stringify({
      unifiedSettings: true,
      savedConnectionExecutionNext: true,
      keyRetention: true,
      catalogSync: true,
    }),
  );
}
