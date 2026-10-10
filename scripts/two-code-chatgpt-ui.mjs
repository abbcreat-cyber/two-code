import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = `D:/Apps/TwoCode/qa/chatgpt-ui-${Date.now()}`;
const workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
const selection = {
  harness: "pi",
  provider: "two-code-chatgpt",
  model: "gpt-6-astra",
  thinking: "low",
};
await fs.writeFile(
  path.join(root, "data/preferences.json"),
  JSON.stringify({ mode: "build", dual: true, lead: selection, sidekick: selection }),
);
await fs.copyFile(
  "D:/Apps/TwoCode/data/chatgpt-connection.json",
  path.join(root, "data/chatgpt-connection.json"),
);
await fs.writeFile(
  path.join(root, "data/model-connections.json"),
  JSON.stringify({ revision: "qa", connections: [], deleted: ["native:pi:codex-gw"] }),
);
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
const executable = process.env.TWO_CODE_QA_EXE;
const app = await electron.launch({
  executablePath: executable || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(executable ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-star-sea").waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    assertBackground(win);
    function assertBackground(w) {
      if (w.isFocusable() || w.getBounds().x > -1000) throw new Error("QA isolation failed");
    }
    win.showInactive();
  });
  for (const theme of ["zai-dark", "zai-light"]) {
    await page.evaluate((value) => localStorage.setItem("zcode-theme", value), theme);
    await page.reload();
    const art = page.getByTestId("two-code-star-sea");
    await art.waitFor();
    await art.evaluate(async (img) => img.decode());
    const picture = await art.boundingBox(),
      greeting = await page.locator("[data-v4-draft-greeting]").boundingBox();
    assert(
      picture.y >= 0 && picture.y + picture.height <= greeting.y + 1,
      "Illustration overlaps greeting",
    );
    await page.screenshot({ animations: "disabled", path: path.join(root, `home-${theme}.png`) });
  }
  await page.getByTestId("two-code-lead-model").click();
  const panel = page.getByTestId("two-code-lead-panel");
  assert.equal(await panel.locator('[data-model-provider="two-code-chatgpt"]').count(), 4);
  assert.equal(await panel.locator('[data-model-provider="codex-gw"]').count(), 0);
  await panel.getByRole("button", { name: "管理模型与连接…" }).click();
  const settings = page.getByTestId("two-code-model-settings");
  await settings
    .getByRole("navigation", { name: "模型连接" })
    .getByRole("button", { name: /ChatGPT 套餐/ })
    .click();
  const editor = page.getByTestId("two-code-connection-editor");
  await editor.getByText("ChatGPT 套餐授权", { exact: true }).waitFor();
  assert.equal(await editor.getByLabel("API 密钥", { exact: true }).count(), 0);
  assert.equal(await editor.getByLabel("API 地址", { exact: true }).isDisabled(), true);
  if (process.env.TWO_CODE_QA_PROBE_LIVE === "1") {
    await editor.getByRole("button", { name: "测试连接", exact: true }).first().click();
    await editor.getByRole("button", { name: "已连通", exact: true }).waitFor({ timeout: 35000 });
  }
  await page.screenshot({
    animations: "disabled",
    path: path.join(root, "subscription-settings.png"),
  });
  await page.getByTestId("settings-back-button").click();
  if (process.env.TWO_CODE_QA_LIVE === "1") {
    await page
      .getByTestId("two-code-composer")
      .fill("只调用一次副手，让副手计算23乘29，主手核对后只回答结果。不要使用其他工具。");
    await page.getByTestId("two-code-send").click();
    await page
      .locator('[data-testid="two-code-state"][data-status="completed"]')
      .waitFor({ timeout: 90000 });
    const files = (await fs.readdir(path.join(root, "data/tasks"))).filter((f) =>
      f.endsWith(".json"),
    );
    assert.equal(files.length, 1);
    const task = JSON.parse(await fs.readFile(path.join(root, "data/tasks", files[0]), "utf8"));
    assert.match(task.lead.lastReport, /667/);
    assert.equal(task.sidekick.status, "completed");
    assert.notEqual(task.lead.sessionId, task.sidekick.sessionId);
    await page.screenshot({
      animations: "disabled",
      path: path.join(root, "subscription-task.png"),
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ passed: true, live: process.env.TWO_CODE_QA_LIVE === "1", errors }),
  );
  console.log(JSON.stringify({ passed: true, root }));
} catch (error) {
  const page = (await app.windows())[0];
  if (page) {
    await page
      .screenshot({ animations: "disabled", path: path.join(root, "failure.png") })
      .catch(() => {});
    await fs.writeFile(path.join(root, "failure.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  await app.close();
}
