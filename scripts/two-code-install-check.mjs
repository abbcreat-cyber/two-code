import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const executablePath =
  process.env.TWO_CODE_QA_EXE || "D:/Apps/TwoCode/releases/0.3.0-final/win-unpacked/Two Code.exe";
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
for (const key of [
  "ELECTRON_RUN_AS_NODE",
  "TWO_CODE_HOME",
  "ZCODE_DATA_BASE_DIR",
  "ZCODE_DESKTOP_APPLICATION_NAME",
  "ZCODE_DESKTOP_USER_DATA_DIR",
  "ZCODE_DESKTOP_SESSION_DATA_DIR",
])
  delete env[key];
const app = await electron.launch({ executablePath, args: ["--disable-gpu"], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 30000 });
  const identity = await app.evaluate(({ app, BrowserWindow }) => ({
    name: app.name,
    userData: app.getPath("userData"),
    executable: process.execPath,
    windows: BrowserWindow.getAllWindows().map((w) => ({
      title: w.getTitle(),
      bounds: w.getBounds(),
      focusable: w.isFocusable(),
    })),
  }));
  assert.equal(identity.name, "Two Code");
  assert.equal(identity.userData.replaceAll("\\", "/"), "D:/Apps/TwoCode/state/electron");
  assert(identity.windows.every((w) => w.bounds.x < -1000 && !w.focusable));
  assert.match(await page.getByTestId("two-code-lead-model").innerText(), /腾讯 DeepSeek/);
  assert.match(await page.getByTestId("two-code-sidekick-model").innerText(), /腾讯 DeepSeek/);
  const savedTasks = (await fs.readdir("D:/Apps/TwoCode/data/tasks")).filter((name) =>
    name.endsWith(".json"),
  );
  for (const filename of savedTasks) {
    const saved = JSON.parse(await fs.readFile(`D:/Apps/TwoCode/data/tasks/${filename}`, "utf8"));
    const row = page.locator(`[data-testid*="task-item"][data-testid$="${saved.id}"]`);
    await row.waitFor({ state: "visible", timeout: 20000 });
    await row.click();
    await page.getByTestId("two-code-state").waitFor({ state: "visible", timeout: 10000 });
    assert.equal(
      await page.getByTestId("two-code-state").getAttribute("data-status"),
      saved.status,
    );
    assert.equal(await page.getByTestId("two-code-lead-model").isEnabled(), true);
    assert.equal(await page.getByTestId("two-code-sidekick-model").isEnabled(), true);
    await page.getByTestId("chat-mode-select-trigger").waitFor({ state: "visible" });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].showInactive();
    });
    await page.screenshot({ path: "D:/Apps/TwoCode/qa/installed-native-history.png" });
    console.log(JSON.stringify({ existingTaskOpened: true, id: saved.id }));
  }
  await fs.writeFile(
    "D:/Apps/TwoCode/qa/installed-identity.json",
    JSON.stringify(identity, null, 2),
  );
  console.log(JSON.stringify({ installedIdentityPassed: true, ...identity }));
} finally {
  await app.close();
}
