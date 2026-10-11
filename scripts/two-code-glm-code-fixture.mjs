import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

export const sidekick = {
  harness: "claude-code",
  provider: "bigmodel-coding-plan",
  model: "glm-5.3",
  thinking: "max",
};

export async function configure(root) {
  const source = JSON.parse(
    await fs.readFile("D:/Apps/TwoCode/data/model-connections.json", "utf8"),
  );
  const connection = source.connections.find((c) => c.id === "claude:bigmodel-coding-plan");
  assert(connection, "先配置Claude Code智谱连接");
  await fs.writeFile(
    `${root}/data/model-connections.json`,
    JSON.stringify({ revision: source.revision, connections: [connection], deleted: [] }),
    { mode: 0o600 },
  );
}

export async function verifyMenu(page) {
  await page.getByTestId("two-code-sidekick-model").click();
  for (const model of ["glm-5.3", "glm-5.3-flash"])
    await page
      .locator(`[data-testid="two-code-sidekick-panel"] [data-model-id="${model}"]`)
      .waitFor();
  await page.getByTestId("two-code-sidekick-model").click();
}

async function nativeModels(task) {
  const file = path.join(
    homedir(),
    ".claude/projects",
    task.workspacePath.replace(/[^a-zA-Z0-9]/g, "-"),
    `${task.sidekick.sessionId}.jsonl`,
  );
  const rows = (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  return [
    ...new Set(
      rows
        .filter((r) => r.type === "assistant")
        .map((r) => r.message?.model)
        .filter(Boolean),
    ),
  ];
}

export async function runScenarios({ run, page, results }) {
  await page
    .getByRole("button", { name: /^新建任务/ })
    .first()
    .click();
  const policy =
    " 全程只用原生文件读写工具与sidekick/read_sidekick，禁止shell、联网、外部浏览器和依赖安装。只在当前任务工作区写qa-glm-code.mjs。主手负责验收并读取副手写出的文件，不直接写文件，副手完成实现。";
  const first = await run(
    "glm-code",
    "GLM代码协作小任务：主手派唯一副手创建qa-glm-code.mjs，导出normalizeRows(rows)。只接受数组中sku为非空字符串、qty为正整数的对象；sku修剪两端空白，同sku累加qty，返回按sku的JS字符串比较升序排序的[{sku,qty}]。忽略null和非法记录，非数组返回空数组；不要改动输入；__proto__也是合法sku。无依赖，不运行命令。主手读最终文件核对。",
    undefined,
    policy,
  );
  assert.equal(first.task.sidekick.selection.model, "glm-5.3");
  assert.equal(first.task.sidekick.selection.thinking, "max");
  const models = await nativeModels(first.task);
  assert(
    models.some((m) => m.toLowerCase() === "glm-5.3"),
    "原生Claude响应必须为GLM-5.3",
  );
  const file = `${first.task.workspacePath}/qa-glm-code.mjs`;
  const { normalizeRows } = await import(pathToFileURL(file).href + "?first");
  const input = [
    { sku: " b ", qty: 2 },
    { sku: "a", qty: 1 },
    { sku: "b", qty: 3 },
    { sku: "__proto__", qty: 4 },
    null,
    { sku: " ", qty: 3 },
    { sku: "z", qty: -1 },
    { sku: "c", qty: 1.5 },
    { sku: "x", qty: "2" },
  ];
  const original = JSON.stringify(input);
  assert.deepEqual(normalizeRows(input), [
    { sku: "__proto__", qty: 4 },
    { sku: "a", qty: 1 },
    { sku: "b", qty: 5 },
  ]);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(normalizeRows(null), []);
  assert(first.task.events.some((e) => e.kind === "handoff_report"));
  results.push({ name: "glm-code", passed: true, elapsedMs: first.elapsedMs, models });

  const next = await run(
    "glm-code-followup",
    "继续原任务，让同一个副手为qa-glm-code.mjs增加导出totalQty(rows)：复用normalizeRows得到有效合并记录并累加qty，空输入返回0。保留normalizeRows行为。主手读文件复核，不运行命令。",
    first.task.id,
    policy,
  );
  assert.deepEqual(
    [next.task.lead.sessionId, next.task.sidekick.sessionId],
    [first.task.lead.sessionId, first.task.sidekick.sessionId],
  );
  const updated = await import(pathToFileURL(file).href + "?second");
  assert.equal(updated.totalQty(input), 10);
  assert.equal(updated.totalQty([]), 0);
  assert.deepEqual(updated.normalizeRows(input), normalizeRows(input));
  await fs.access(file);
  results.push({ name: "glm-code-followup", passed: true, elapsedMs: next.elapsedMs });

  await page
    .getByRole("button", { name: /^新建任务/ })
    .first()
    .click();
  await page.getByTestId("two-code-sidekick-model").click();
  await page
    .locator(
      '[data-testid="two-code-sidekick-panel"] [data-model-id="glm-5.3-flash"][data-model-provider="bigmodel-coding-plan"]',
    )
    .click();
  const flash = await run(
    "glm-flash",
    "Flash调用验收：主手必须派唯一副手回答17乘19的结果，副手报告带FLASH_OK，主手读报告后给出结果。禁止其他工具、文件操作或联网。",
    undefined,
    " 只使用sidekick/read_sidekick完成这次分工，不自行替代副手。",
  );
  const flashModels = await nativeModels(flash.task);
  assert(
    flashModels.some((m) => m.toLowerCase() === "glm-5.3-flash"),
    "原生Claude响应必须为GLM-5.3-Flash",
  );
  assert.match(flash.task.sidekick.lastReport, /323/);
  assert.match(flash.task.sidekick.lastReport, /FLASH_OK/);
  results.push({
    name: "glm-flash",
    passed: true,
    elapsedMs: flash.elapsedMs,
    models: flashModels,
  });
}
