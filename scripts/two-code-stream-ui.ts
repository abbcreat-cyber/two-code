import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";
const root = `D:/Apps/TwoCode/qa/stream-ui-${Date.now()}`,
  cwd = `${root}/data/.zcode/workspace/default`;
await fs.mkdir(cwd, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const pair = {
  dual: true,
  mode: "edit" as const,
  lead: { harness: "step-code" as const, provider: "step-plan", model: "step-5-preview" },
  sidekick: { harness: "claude-code" as const, model: "claude-sonnet-4-8", thinking: "high" },
};
const replay = await service.create({ ...pair, workspacePath: cwd, title: "整句显示回放" });
await service.configurePreferences(pair);
await service.catalog();
await services.get(IProviderSettingsService).getView();
await disposeServiceResourcesAndWait(services);
const original = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/tasks/f3e54520-a69e-4f28-917b-9f85fc32281d.json", "utf8"),
);
await fs.writeFile(
  `${root}/data/tasks/${replay.id}.json`,
  JSON.stringify({
    ...original,
    id: replay.id,
    title: replay.title,
    workspacePath: replay.workspacePath,
    lead: { ...original.lead, sessionId: undefined },
    sidekick: { ...original.sidekick, sessionId: undefined },
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "D:/Apps/TwoCode/releases/0.8.7/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const results: { root: string; passed?: boolean; error?: string; liveReply?: string } = { root },
  errors: string[] = [];
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("isolation");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  console.log(JSON.stringify({ root }));
  const expected = "两位模型已经准备好，可以开始协作。";
  await page.getByTestId("two-code-composer").fill(`请只回复完整一句话：${expected}`);
  await page.getByTestId("two-code-send").click();
  const end = Date.now() + 90000;
  let live;
  while (Date.now() < end) {
    const names = (await fs.readdir(`${root}/data/tasks`)).filter(
      (n) => n.endsWith(".json") && n !== `${replay.id}.json`,
    );
    if (names.length) {
      const t = JSON.parse(await fs.readFile(`${root}/data/tasks/${names[0]}`, "utf8"));
      if (t.status !== "running") {
        live = t;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  assert(live);
  assert.equal(live.status, "completed", live.error);
  assert.equal(live.lead.lastReport.trim(), expected);
  assert(
    live.events.some((e: { kind: string; blockId?: string }) => e.kind === "message" && e.blockId),
  );
  await page.getByText(expected, { exact: true }).waitFor();
  results.liveReply = expected;
  await page
    .locator("[data-task-item-key], [data-grouped-task-key]")
    .filter({ hasText: "整句显示回放" })
    .first()
    .click();
  await page.getByTestId("two-code-state").waitFor();
  for (const b of await page
    .getByRole("button")
    .filter({ hasText: /已工作/ })
    .all())
    if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  const opener = page.getByText('我来查一下有没有叫 "Fable 5" 的模型。', { exact: true });
  await opener.waitFor();
  assert.equal(await page.getByText("我来", { exact: true }).count(), 0);
  assert.equal(await page.getByText("打", { exact: true }).count(), 0);
  await opener.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${root}/replayed.png`, animations: "disabled" });
  await page.reload();
  await page.getByTestId("two-code-state").waitFor();
  for (const b of await page
    .getByRole("button")
    .filter({ hasText: /已工作/ })
    .all())
    if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await opener.waitFor();
  assert.deepEqual(errors, []);
  results.passed = true;
} catch (e) {
  results.passed = false;
  results.error = String(e);
  process.exitCode = 1;
  await page?.screenshot({ path: `${root}/failure.png` }).catch(() => {});
  if (page) await fs.writeFile(`${root}/failure.txt`, await page.locator("body").innerText());
} finally {
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ ...results, errors }, null, 2));
  console.log(JSON.stringify({ ...results, errors }));
  await app.close();
}
