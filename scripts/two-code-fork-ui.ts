import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const root = `D:/Apps/TwoCode/qa/fork-ui-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, ISettingService, IProviderSettingsService, twoCodeForkPoints } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const source = JSON.parse(
  await fs.readFile(
    process.env.TWO_CODE_FORK_SOURCE ||
      "D:/Apps/TwoCode/qa/fork-1791710008060/source-before-fork.json",
    "utf8",
  ),
);
const created = await service.create({
  workspacePath: source.workspacePath,
  title: "叉子界面验收",
  dual: source.dual,
  mode: source.mode,
  lead: source.lead.selection,
  sidekick: source.sidekick.selection,
});
const replay = { ...source, id: created.id, title: created.title };
await service.catalog();
await services.get(IProviderSettingsService).getView();
await services
  .get(ISettingService)
  .update({
    lastWorkspaceSession: [{ kind: "local", workspacePath: created.workspacePath }],
    lastActiveTabIndex: 0,
  });
await disposeServiceResourcesAndWait(services);
await fs.writeFile(`${root}/data/tasks/${created.id}.json`, JSON.stringify(replay));
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: `${process.env.TWO_CODE_RELEASE_DIR || "D:/Apps/TwoCode/releases/0.8.15"}/win-unpacked/Two Code.exe`,
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const page = await app.firstWindow(),
  errors: string[] = [];
let passed = false;
try {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("isolation");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  await page
    .locator("[data-task-item-key], [data-grouped-task-key]")
    .filter({ hasText: created.title })
    .first()
    .click();
  await page.getByTestId("two-code-state").waitFor();
  const forks = page.locator('[data-testid^="v4-fork-"]');
  await forks.first().waitFor();
  assert.equal(await forks.count(), twoCodeForkPoints(replay).length);
  await forks.first().scrollIntoViewIfNeeded();
  await forks.first().hover();
  await page.screenshot({ path: `${root}/fork-button.png`, animations: "disabled" });
  await forks.first().click();
  await page
    .locator('[data-testid="v4-session-title"][data-title$=" · 分支"]')
    .waitFor({ timeout: 30000 });
  const names = (await fs.readdir(`${root}/data/tasks`)).filter(
    (n) => n.endsWith(".json") && !n.startsWith(created.id),
  );
  assert.equal(names.length, 1);
  const branch = JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"));
  assert.equal(branch.forkSource.atSeq, twoCodeForkPoints(replay)[0]);
  assert.notEqual(branch.lead.sessionId, replay.lead.sessionId);
  assert.notEqual(branch.sidekick.sessionId, replay.sidekick.sessionId);
  assert(!branch.events.some((e: { text: string }) => e.text.includes("FORK_SOURCE_8246")));
  await page.reload();
  await page.locator('[data-testid="v4-session-title"][data-title$=" · 分支"]').waitFor();
  await page.screenshot({ path: `${root}/branch.png`, animations: "disabled" });
  assert.deepEqual(errors, []);
  await fs.writeFile(`${root}/branch.json`, JSON.stringify(branch, null, 2));
  passed = true;
} catch (e) {
  console.log(String(e));
  await page.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  await fs.writeFile(`${root}/error.txt`, String(e));
} finally {
  await app.close();
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, passed, errors }, null, 2));
  console.log(JSON.stringify({ root, passed, errors }));
  if (!passed) process.exitCode = 1;
}
