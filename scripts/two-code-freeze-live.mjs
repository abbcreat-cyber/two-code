import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { configure } from "./two-code-glm-code-fixture.mjs";
const root = `D:/Apps/TwoCode/qa/freeze-live-${Date.now()}`;
const report = root.replace("/qa/", "/reports/");
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.mkdir(report, { recursive: true });
await configure(root);
const original = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/tasks/8726e1c9-0b0e-4d9c-b056-720bd1efebbf.json", "utf8"),
);
await fs.writeFile(
  `${root}/data/preferences.json`,
  JSON.stringify({
    dual: true,
    mode: "yolo",
    lead: original.lead.selection,
    sidekick: original.sidekick.selection,
  }),
);
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: `${root}/data`,
  ZCODE_DATA_BASE_DIR: `${root}/data`,
  ZCODE_DESKTOP_USER_DATA_DIR: `${root}/electron`,
  ZCODE_DESKTOP_SESSION_DATA_DIR: `${root}/electron/session`,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ZCODE_DESKTOP_APPLICATION_NAME: "Two Code Freeze Live QA",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "D:/Apps/TwoCode/releases/0.8.33-r2/win-unpacked/Two Code.exe",
  args: [],
  env,
  timeout: 60000,
});
const samples = [];
let outcome = "unknown";
let task;
let gpuStatus;
const bounded = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("UI responsiveness timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
try {
  const page = await app.firstWindow();
  await page.getByTestId("two-code-native-session").waitFor({ state: "visible", timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isFocusable() || w.getBounds().x > -1000) throw Error("Not isolated");
    w.showInactive();
  });
  gpuStatus = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
  const cdp = await page.context().newCDPSession(page);
  console.log(JSON.stringify({ stage: "gpu", gpuStatus }));
  await page
    .getByTestId("two-code-composer")
    .fill(original.events.find((e) => e.role === "user").text);
  await page.getByTestId("two-code-send").click();
  await page
    .locator('[data-testid="two-code-state"][data-status="running"]')
    .waitFor({ timeout: 20000 });
  console.log(
    JSON.stringify({
      stage: "started",
      root,
      report,
      pair: { lead: original.lead.selection, sidekick: original.sidekick.selection },
      limitSeconds: 120,
    }),
  );
  const start = Date.now();
  let baselineMB = 0;
  while (Date.now() - start < 120000) {
    await new Promise((r) => setTimeout(r, 2000));
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => ({
        type: m.type,
        cpu: m.cpu.percentCPUUsage,
        mb: Math.round(m.memory.workingSetSize / 1024),
      })),
    );
    const at = Date.now();
    const state = await bounded(
      page.evaluate(() => ({
        status: document
          .querySelector('[data-testid="two-code-state"]')
          ?.getAttribute("data-status"),
        nodes: document.querySelectorAll("*").length,
        reasoningText:
          document.querySelector("[data-reasoning-streaming-text]")?.textContent?.length || 0,
      })),
      3000,
    );
    const responseMs = Date.now() - at;
    const heap = await cdp.send("Runtime.getHeapUsage");
    const renderer = metrics.filter((m) => m.type === "Tab");
    const mb = renderer.reduce((a, b) => a + b.mb, 0);
    baselineMB ||= mb;
    const sample = {
      seconds: Math.round((Date.now() - start) / 1000),
      responseMs,
      heapMB: Math.round(heap.usedSize / 1048576),
      metrics,
      ...state,
    };
    samples.push(sample);
    if (samples.length % 5 === 0) console.log(JSON.stringify({ stage: "sample", ...sample }));
    if (state.status !== "running") {
      outcome = state.status;
      break;
    }
    if (responseMs > 1500 || mb > baselineMB + 384 || renderer.some((m) => m.cpu > 25)) {
      outcome = "resource-guard";
      break;
    }
  }
  if (outcome === "unknown") outcome = "time-limit";
  if ((await page.getByTestId("two-code-stop").count()) > 0) {
    await page.getByTestId("two-code-stop").click({ timeout: 3000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="two-code-state"]')?.getAttribute("data-status") !==
        "running",
      {},
      { timeout: 20000 },
    );
  }
  const files = await fs.readdir(`${root}/data/tasks`);
  const file = files.find((f) => f.endsWith(".json"));
  task = JSON.parse(await fs.readFile(`${root}/data/tasks/${file}`, "utf8"));
  await fs.writeFile(`${report}/task.json`, JSON.stringify(task, null, 2));
  await page.screenshot({ path: `${report}/final.png`, animations: "disabled" });
  console.log(
    JSON.stringify({
      stage: "finished",
      outcome,
      taskStatus: task.status,
      eventCount: task.events.length,
      reasoning: task.events.filter((e) => e.kind === "reasoning").length,
      usage: task.usage,
      report,
    }),
  );
} finally {
  await fs.writeFile(
    `${report}/samples.json`,
    JSON.stringify({ version: "0.8.33", gpuStatus, outcome, samples }, null, 2),
  );
  try {
    await app.close();
  } finally {
    // 测试配置含连接凭据，即使测试窗口关闭失败也不得遗留副本。
    await fs.unlink(`${root}/data/model-connections.json`);
  }
}
