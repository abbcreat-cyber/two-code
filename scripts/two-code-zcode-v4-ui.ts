import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright-core";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\zcode-v4-\d+$/.test(root));
const ui = root + `/ui-${Date.now()}`;
const data = ui + "/data",
  cwd = data + "/.zcode/workspace/default";
await fs.mkdir(cwd, { recursive: true });
await fs.mkdir(data + "/.zcode/v2", { recursive: true });
await fs.copyFile(
  root + "/data/.zcode/v2/provider_config.json",
  data + "/.zcode/v2/provider_config.json",
);
process.env.TWO_CODE_HOME = data;
process.env.ZCODE_DATA_BASE_DIR = data;
process.env.ZCODE_HOME = data + "/.zcode";
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService),
  prepared: any[] = [];
for (const name of ["zcode-lead", "zcode-sidekick"]) {
  const original = JSON.parse(await fs.readFile(`${root}/${name}-final.json`, "utf8"));
  const created = await service.create({
    workspacePath: cwd,
    title: `ZCode修复回放-${name}`,
    dual: true,
    mode: "yolo",
    lead: original.lead.selection,
    sidekick: original.sidekick.selection,
  });
  prepared.push({
    ...original,
    id: created.id,
    title: created.title,
    workspacePath: created.workspacePath,
    lead: { ...original.lead, sessionId: undefined },
    sidekick: { ...original.sidekick, sessionId: undefined },
  });
}
await service.catalog();
await services.get(IProviderSettingsService).getView();
await disposeServiceResourcesAndWait(services);
for (const t of prepared) await fs.writeFile(`${data}/tasks/${t.id}.json`, JSON.stringify(t));
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  ZCODE_DESKTOP_USER_DATA_DIR: ui + "/electron",
  ZCODE_DESKTOP_SESSION_DATA_DIR: ui + "/electron/session",
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "D:/Apps/TwoCode/releases/0.8.27/win-unpacked/Two Code.exe",
  args: ["--disable-gpu"],
  env,
  timeout: 60000,
});
const errors: string[] = [],
  proof: any[] = [];
let page: Awaited<ReturnType<typeof app.firstWindow>> | undefined;
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("two-code-lead-model").waitFor({ timeout: 40000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("后台隔离失败");
    w.setSize(1280, 1000);
    w.showInactive();
  });
  for (const t of prepared) {
    await page
      .locator("[data-task-item-key], [data-grouped-task-key]")
      .filter({ hasText: t.title })
      .first()
      .click();
    await page.getByTestId("two-code-state").waitFor({ timeout: 15000 });
    for (const b of await page
      .getByRole("button")
      .filter({ hasText: /已工作/ })
      .all())
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    await page
      .getByText(/ZCODE_V4_OK/)
      .first()
      .waitFor();
    const tools = await page
      .locator("[data-tool-name]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("data-tool-name")));
    assert.equal(tools.filter((n) => n === "sidekick").length, 3, "三次交接各显示一行");
    assert(!tools.some((n) => /^mcp__two_code__sidekick$/i.test(n ?? "")), "不能重复显示原生草稿");
    const second = page.locator('[data-tool-name="sidekick"]').nth(1);
    const trigger = second.locator('[data-testid^="tool-summary-trigger"]');
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await page
      .getByText(/调用工具：read/i)
      .first()
      .waitFor();
    await page.screenshot({ path: `${root}/${t.title}.png`, animations: "disabled" });
    proof.push({ title: t.title, tools });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    root + "/ui-result.json",
    JSON.stringify({ passed: true, version: "0.8.27", proof, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, root, proof }));
} catch (error) {
  await page?.screenshot({ path: root + "/ui-failure.png" }).catch(() => {});
  await fs.writeFile(
    root + "/ui-failure.txt",
    JSON.stringify(
      { error: String(error), body: await page?.locator("body").innerText(), errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app.close();
}
