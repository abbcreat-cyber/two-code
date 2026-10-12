import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
import { configureRole } from "./two-code-settings-ui.mjs";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\step-plan-harness-\d+$/.test(root));
const data = path.join(root, "ui/data");
await fs.mkdir(path.join(data, ".zcode/workspace/default"), { recursive: true });
const selected = (harness) => ({
  harness,
  provider: "step-plan",
  model: "step-5-preview",
  thinking: "medium",
});
await fs.writeFile(
  path.join(data, "preferences.json"),
  JSON.stringify({
    dual: true,
    mode: "yolo",
    lead: selected("pi"),
    sidekick: selected("claude-code"),
  }),
);
assert(process.env.TWO_CODE_QA_EXE, "请指定完整验收包");
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: data,
  ZCODE_DATA_BASE_DIR: data,
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "ui/electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "ui/electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.TWO_CODE_QA_EXE,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  const identity = await app.evaluate(({ app, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("后台隔离未生效");
    w.showInactive();
    return { version: app.getVersion(), executable: process.execPath };
  });
  for (const harness of ["pi", "claude-code"]) {
    for (const role of ["lead", "sidekick"]) {
      await configureRole(page, role, {
        harness,
        model: "step-5-preview",
        provider: "step-plan",
        thinking: "medium",
      });
      await page
        .getByTestId(`two-code-${role}-model`)
        .getByText("Step-5 订阅", { exact: true })
        .waitFor();
    }
    await page.getByTestId("two-code-lead-model").click();
    await page.screenshot({
      path: path.join(root, `${harness}-step-plan.png`),
      animations: "disabled",
    });
    await page
      .getByTestId("two-code-lead-panel")
      .getByRole("button", { name: "管理模型与连接…" })
      .click();
    const settings = page.getByTestId("two-code-model-settings");
    await page.getByTestId(`two-code-settings-${harness}`).click();
    await settings
      .getByRole("navigation", { name: "模型连接" })
      .getByRole("button", { name: /Step-5 订阅/ })
      .click();
    const editor = page.getByTestId("two-code-connection-editor");
    assert.equal(await editor.getByLabel("API 密钥", { exact: true }).inputValue(), "");
    assert.equal(
      await editor.getByLabel("API 地址", { exact: true }).inputValue(),
      harness === "pi"
        ? "https://api.stepfun.com/step_plan/v1"
        : "https://api.stepfun.com/step_plan",
    );
    await page.getByTestId("settings-back-button").click();
  }
  await page.reload();
  for (const role of ["lead", "sidekick"])
    await page
      .getByTestId(`two-code-${role}-model`)
      .getByText("Step-5 订阅", { exact: true })
      .waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "ui-result.json"),
    JSON.stringify(
      {
        passed: true,
        ...identity,
        roles: ["lead", "sidekick"],
        harnesses: ["pi", "claude-code"],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, ...identity, root }));
} finally {
  await app.close();
}
