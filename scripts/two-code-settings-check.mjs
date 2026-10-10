import fs from "node:fs/promises";
import { checkModelSettings } from "./two-code-settings-ui.mjs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { _electron as electron } from "playwright-core";
const repo = path.resolve(import.meta.dirname, "..");
const root = process.env.TWO_CODE_QA_ROOT || `D:/Apps/TwoCode/qa/integration-${Date.now()}`;
const workspace = path.join(root, "data/.zcode/workspace/default");
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(path.join(root, "data/tasks"), { recursive: true });
const preferences = JSON.parse(await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"));
preferences.mode = "build";
preferences.lead = { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" };
preferences.sidekick = {
  harness: "pi",
  provider: "ds-tencent",
  model: "claude-sonnet-4-8",
  thinking: "high",
};
await fs.writeFile(path.join(root, "data/preferences.json"), JSON.stringify(preferences));
const legacyId = randomUUID(),
  at = new Date().toISOString();
await fs.writeFile(
  path.join(root, `data/tasks/${legacyId}.json`),
  JSON.stringify({
    id: legacyId,
    workspacePath: workspace,
    title: "旧任务迁移检查",
    dual: true,
    status: "completed",
    lead: { selection: preferences.lead, status: "completed" },
    sidekick: { selection: preferences.sidekick, status: "idle" },
    events: [
      { seq: 1, at, role: "user", kind: "message", text: "旧任务迁移检查" },
      { seq: 2, at, role: "lead", kind: "message", text: "**历史记录**应显示在原生聊天中。" },
    ],
    permissions: [],
    requestIds: [],
    updatedAt: at,
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: path.join(root, "data"),
  ZCODE_DATA_BASE_DIR: path.join(root, "data"),
  ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "electron"),
  ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "electron/session"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code Integration QA",
};
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.TWO_CODE_QA_EXE;
const app = await electron.launch({
  executablePath: executable || path.join(repo, "node_modules/electron/dist/electron.exe"),
  args: [...(executable ? [] : [path.join(repo, "packages/desktop")]), "--disable-gpu"],
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.getByTestId('two-code-lead-model').waitFor({timeout:30000});
  await app.evaluate(({BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows()[0];
    if(win.isFocusable() || win.getBounds().x > -1000) throw new Error('QA isolation failed');
    win.showInactive();
  });
  await page.getByTestId('two-code-lead-model').click();
  const panel=page.getByTestId('two-code-lead-panel');
  assert.equal(await panel.getByText('模型待确认', {exact:true}).count(),0);
  await panel.getByRole('combobox',{name:'主手思考档位'}).click();
  await page.getByRole('option',{name:'高',exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:path.join(root,'thinking-menu.png')});
  await page.getByRole('option',{name:'高',exact:true}).click();
  await panel.getByRole('button',{name:'管理模型与连接…'}).click();
  await checkModelSettings(page,root);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'observation.json'),JSON.stringify({passed:true,errors,root},null,2));
  console.log(JSON.stringify({passed:true,root}));
} catch(error) {
  const page=(await app.windows())[0];
  if(page){
    await page.screenshot({animations:'disabled',path:path.join(root,'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(root,'failure.txt'),await page.locator('body').innerText());
  }
  throw error;
} finally { await app.close(); }
