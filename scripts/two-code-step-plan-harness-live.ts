import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCodingFixture } from "./two-code-coding-fixtures.js";
import { readLedger, nativeModels, stageMetrics, artifacts } from "./two-code-role-swap-metrics.js";
import type { HarnessId, TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/step-plan-harness-${Date.now()}`;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-step-plan-harness-qa", root }),
);
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const owned: string[] = [];
const results: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = {},
  outputs: Record<string, unknown> = {};
const select = (harness: HarnessId) => ({
  harness,
  provider: "step-plan",
  model: "step-5-preview",
  thinking: "medium",
});
async function turn(id: string, text: string) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const end = Date.now() + 240000;
  let task = await service.read(id);
  while (task.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    task = await service.read(id);
  }
  if (task.status === "running") task = await service.cancel(id);
  assert.equal(task.status, "completed", task.error ?? "超时或未完成");
  assert.equal(task.permissions.length, 0);
  return task;
}
async function run(lead: HarnessId, sidekick: HarnessId) {
  const label = `${lead}-to-${sidekick}`,
    cwd = `${root}/${label}`;
  const fixture = await createCodingFixture("small", cwd);
  const t = await service.create({
    workspacePath: cwd,
    title: `Step订阅-${label}`,
    dual: true,
    mode: "yolo",
    lead: select(lead),
    sidekick: select(sidekick),
  });
  owned.push(t.id);
  const start = Date.now();
  try {
    const first = await turn(
      t.id,
      `${fixture.stages[0].brief}\n仅修改src/names.mjs；不要修改check.mjs或.qa，不联网，不安装依赖。主手派唯一副手实现并用原生命令工具执行node check.mjs all；主手读取源码和回执审查，不直接写实现。`,
    );
    assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture.check);
    assert((await readLedger(cwd)).at(-1)?.passed);
    const source = await fs.readFile(`${cwd}/src/names.mjs`, "utf8");
    const second = await turn(
      t.id,
      "继续上一轮：不要改文件或重跑测试。请主手让同一个副手读取src/names.mjs，说明为什么不会修改调用者输入，然后主手用一句完整中文确认。必须再次交接，沿用本会话。",
    );
    for (const role of ["lead", "sidekick"] as const) {
      assert.equal(second[role].sessionId, first[role].sessionId, "续轮会话变更");
      assert(second[role].actualModel?.endsWith("step-5-preview"));
    }
    assert.equal(await fs.readFile(`${cwd}/src/names.mjs`, "utf8"), source);
    const metrics = stageMetrics(second, 0, await readLedger(cwd));
    assert.equal(metrics.handoffs, 2);
    assert.equal(metrics.reports, 2);
    assert(metrics.validationRuns >= 1);
    // 首轮可能自行重复确认退出码；它是效率观察，续轮才明确禁止重验。
    const continued = stageMetrics(second, first.events.at(-1)!.seq, []);
    assert.equal(continued.receipts.length, 0, "只读续轮不应重跑测试");
    assert.equal(metrics.leadWriteCalls, 0);
    assert.deepEqual(metrics.errors, []);
    results.push({ label, taskId: t.id, passed: true, elapsedMs: Date.now() - start, ...metrics });
  } catch (e) {
    results.push({ label, taskId: t.id, passed: false, error: String(e) });
  } finally {
    let final: TwoCodeTask = await service.read(t.id);
    if (final.status === "running") final = await service.cancel(t.id);
    await fs.writeFile(`${root}/${label}.json`, JSON.stringify(final, null, 2));
    evidence[label] = await nativeModels(final);
    outputs[label] = await artifacts(cwd);
    console.log(JSON.stringify(results.find((r) => r.label === label)));
  }
}
console.log(JSON.stringify({ root }));
try {
  const catalog = await service.catalog();
  for (const harness of ["pi", "claude-code"])
    assert(
      catalog
        .find((h) => h.id === harness)
        ?.models.some((m) => m.provider === "step-plan" && m.id === "step-5-preview"),
    );
  await Promise.all([run("pi", "claude-code"), run("claude-code", "pi")]);
} finally {
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await fs.writeFile(`${root}/native-model-evidence.json`, JSON.stringify(evidence, null, 2));
  await fs.writeFile(`${root}/artifacts.json`, JSON.stringify(outputs, null, 2));
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ taskIds: owned, at: new Date().toISOString() }),
  );
}
if (results.length !== 2 || results.some((r) => !r.passed)) process.exitCode = 1;
