import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, ".."),
  root = `D:/Apps/TwoCode/qa/step-ui-${Date.now()}`,
  workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(path.join(root, "data"), { recursive: true });
await fs.writeFile(
  path.join(root, "data/preferences.json"),
  JSON.stringify({
    dual: true,
    mode: "build",
    lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    sidekick: { harness: "step-code", provider: "step-api", model: "step-5-preview" },
  }),
);
const executable = process.env.TWO_CODE_QA_EXE;
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: path.join(root, "data"),
  ZCODE_DATA_BASE_DIR: path.join(root, "data"),
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
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
  await page.getByTestId("two-code-lead-model").waitFor({ state: "visible", timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("后台隔离未生效");
    w.showInactive();
  });
  await page.getByTestId("two-code-lead-model").click();
  const panel = page.getByTestId("two-code-lead-panel");
  assert.equal(
    await panel
      .getByRole("option", { name: "Step-5 API", exact: true })
      .getAttribute("data-model-provider"),
    "step-api",
  );
  assert.equal(
    await panel
      .getByRole("option", { name: "Step-5 订阅", exact: true })
      .getAttribute("data-model-provider"),
    "step-plan",
  );
  await page.screenshot({ path: path.join(root, "two-channels.png"), animations: "disabled" });
  await panel.getByRole("option", { name: "Step-5 API", exact: true }).click();
  await page.getByTestId("two-code-lead-model").getByText("Step-5 API", { exact: true }).waitFor();
  await page.getByTestId("two-code-lead-model").click();
  await panel.getByRole("option", { name: "Step-5 订阅", exact: true }).click();
  await page.getByTestId("two-code-sidekick-model").click();
  const side = page.getByTestId("two-code-sidekick-panel");
  await side.getByRole("option", { name: "Step-5 订阅", exact: true }).click();
  await page.getByTestId("two-code-sidekick-model").click();
  await side.getByRole("button", { name: "管理模型与连接…" }).click();
  const settings = page.getByTestId("two-code-model-settings");
  await settings.waitFor();
  for (const id of ["zcode", "claude-code", "pi", "step-code"])
    assert.equal(await page.getByTestId("two-code-settings-" + id).count(), 1);
  await page.getByTestId("two-code-settings-step-code").click();
  const nav = settings.getByRole("navigation", { name: "模型连接" });
  assert.equal(await nav.getByRole("button", { name: /Step-5 API/ }).count(), 1);
  assert.equal(await nav.getByRole("button", { name: /Step-5 订阅/ }).count(), 1);
  await nav.getByRole("button", { name: /Step-5 API/ }).click();
  const editor = page.getByTestId("two-code-connection-editor");
  await editor.waitFor();
  assert(
    (await editor.getByLabel("API 密钥", { exact: true }).inputValue()) === "",
    "密钥输入必须为空",
  );
  await page.screenshot({ path: path.join(root, "four-harnesses.png"), animations: "disabled" });
  await page.getByTestId("settings-back-button").click();
  await page.reload();
  await page
    .getByTestId("two-code-lead-model")
    .getByText("Step-5 订阅", { exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByTestId("two-code-sidekick-model")
    .getByText("Step-5 订阅", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      { fourHarnesses: true, twoChannels: true, leadSideSelectionAndReload: true, errors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ root, fourHarnesses: true, twoChannels: true, errors }));
} finally {
  await app.close();
}
