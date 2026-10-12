import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/reports/local-profile-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: `${root}/data`,
  ZCODE_DATA_BASE_DIR: `${root}/data`,
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code Profile QA",
};
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.TWO_CODE_QA_EXE;
const app = await electron.launch({
  executablePath: exe || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(exe ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
  timeout: 60000,
});
const checks = [];
try {
  const page = await app.firstWindow();
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    assertBackground(w);
    function assertBackground(w) {
      if (w.isFocusable() || w.getBounds().x > -1000) throw Error("Window not isolated");
      w.showInactive();
    }
  });
  const trigger = page.getByTestId("login-trigger");
  assert.equal(await trigger.innerText(), "Two Code");
  await trigger.click();
  assert.equal(await page.getByRole("menuitem", { name: "连接使用", exact: true }).count(), 0);
  assert.equal(await page.getByTestId("sidebar-coding-plan-upgrade-button").count(), 0);
  await page.screenshot({ animations: "disabled", path: `${root}/menu.png` });
  checks.push("removed upgrade and connect entries; local default");
  const edit = async () => {
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByTestId("local-profile-edit").waitFor({ state: "hidden" });
    await trigger.click();
    await page.getByTestId("local-profile-edit").click();
  };
  await page.getByTestId("local-profile-edit").click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox");
  const save = dialog.getByRole("button", { name: "保存", exact: true });
  await input.waitFor();
  assert(await input.evaluate((el) => document.activeElement === el));
  assert.equal(await input.evaluate((el) => el.selectionEnd - el.selectionStart), 8);
  await input.fill("星海领航员");
  await page.screenshot({ animations: "disabled", path: `${root}/dialog-dark.png` });
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.innerText(), "星海领航员");
  await page.reload();
  await trigger.waitFor();
  assert.equal(await trigger.innerText(), "星海领航员");
  checks.push("focused and selected input; saved immediately; persisted after reload");
  await edit();
  await input.fill("不要保存");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await trigger.innerText(), "星海领航员");
  await edit();
  await input.fill("   ");
  assert(await save.isDisabled());
  await input.fill("星".repeat(25));
  assert(await save.isDisabled());
  await input.fill("🚀".repeat(24));
  assert(await save.isEnabled());
  assert((await dialog.innerText()).includes("24 / 24"));
  await input.dispatchEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  });
  assert.equal(await trigger.innerText(), "星海领航员");
  checks.push("cancel and Escape do not save; blank and 25 chars rejected; 24 emoji accepted");
  await edit();
  await input.fill("  新名字  ");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreProfileStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "two-code.local-profile-name") throw new DOMException("QA", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await save.click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await trigger.innerText(), "星海领航员");
  await page.evaluate(() => {
    window.__restoreProfileStorage();
    delete window.__restoreProfileStorage;
  });
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.innerText(), "新名字");
  checks.push("storage failure preserves old name and draft; retry succeeds; whitespace trimmed");
  await trigger.click();
  await page.getByRole("menuitem", { name: "界面主题", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "浅色主题", exact: true }).click();
  await edit();
  await page.screenshot({ animations: "disabled", path: `${root}/dialog-light.png` });
  await input.dispatchEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await trigger.click();
  await page.getByRole("menuitem", { name: "界面语言", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await edit();
  await page.getByRole("heading", { name: "Your name", exact: true }).waitFor();
  checks.push("light theme and English localization");
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, root }));
} finally {
  await app.close();
}
