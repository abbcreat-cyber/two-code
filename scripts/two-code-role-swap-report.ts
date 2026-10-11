import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readLedger, stageMetrics, nativeModels } from "./two-code-role-swap-metrics.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\role-swap-\d+$/.test(root), "仅分析本轮所属对比目录");
const owner = JSON.parse(await fs.readFile(`${root}/owner.json`, "utf8"));
assert.equal(owner.kind, "two-code-role-swap-qa");
await fs.access(`${root}/closed.json`);
const data = JSON.parse(await fs.readFile(`${root}/results.json`, "utf8"));
const native: Record<string, unknown> = {};
const allSessions = new Set<string>();
for (const result of data.results) {
  const task: TwoCodeTask = JSON.parse(
    await fs.readFile(`${root}/${result.label}-final.json`, "utf8"),
  );
  assert.equal(task.mode, "yolo");
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(`${task.workspacePath}/check.mjs`))
      .digest("hex"),
    result.fixtureHash,
    "固定测试在任务结束后仍须保持原样",
  );
  const ledger = await readLedger(task.workspacePath);
  result.audit = stageMetrics(task, 0, ledger);
  const expected = result.size === "long" ? ["core", "storage", "expiry", "all"] : ["all"];
  result.expectedStages = expected.length;
  result.validatedStages = expected.filter((phase) =>
    ledger.some((r) => r.phase === phase && r.passed),
  ).length;
  result.firstValidationPassCount = expected.filter(
    (phase) => ledger.find((r) => r.phase === phase)?.passed,
  ).length;
  result.codeValidationPassed = result.validatedStages === expected.length;
  native[result.label] = await nativeModels(task);
  for (const actor of [task.lead, task.sidekick])
    if (actor.sessionId) {
      const isStep = actor.selection.harness === "step-code";
      assert.equal(actor.actualModel, isStep ? "step-plan/step-5-preview" : "glm-5.3");
      assert.equal(actor.selection.thinking, isStep ? "medium" : "max");
      assert(!allSessions.has(actor.sessionId), "不同任务原生session不能共用");
      allSessions.add(actor.sessionId);
    }
}
assert.equal(data.permissions.length, 0, "完全访问对比不应出现等待用户的审批");
await fs.writeFile(`${root}/native-model-evidence.json`, JSON.stringify(native, null, 2));
await fs.writeFile(`${root}/comparison.json`, JSON.stringify(data, null, 2));
const seconds = (ms: number) => (ms / 1000).toFixed(1);
const sizes = ["small", "medium", "long"];
const names = { small: "小：去重函数", medium: "中：CSV汇总与CLI", long: "长：库存模块四阶段" };
const lines = [
  "# Step 5与GLM-5.3主副互换实测",
  "",
  "A：Step 5订阅 medium主手 + Claude GLM-5.3 max副手。",
  "B：Claude GLM-5.3 max主手 + Step 5订阅 medium副手。",
  "",
  "两组均为完全访问，同档成对并发，使用相同固定测试；每档仅一对样本。正式默认组合未修改。",
  "",
  "| 任务 | A耗时 | B耗时 | A交付 | B交付 | A/B首次测试通过阶段 |",
  "|---|---:|---:|---|---|---|",
];
for (const size of sizes) {
  const a = data.results.find((r: any) => r.label === `A-${size}`),
    b = data.results.find((r: any) => r.label === `B-${size}`);
  if (!a || !b) continue;
  lines.push(
    `| ${names[size as keyof typeof names]} | ${seconds(a.elapsedMs)}秒 | ${seconds(b.elapsedMs)}秒 | ${a.passed ? "完成" : "未完成"}；代码${a.validatedStages}/${a.expectedStages}阶段通过 | ${b.passed ? "完成" : "未完成"}；代码${b.validatedStages}/${b.expectedStages}阶段通过 | ${a.firstValidationPassCount}/${a.expectedStages} · ${b.firstValidationPassCount}/${b.expectedStages} |`,
  );
}
lines.push(
  "",
  "| 组合 | 累计执行耗时 | 完成交付 | 实际测试次数 | 失败测试 | 重复通过验证 | 工具错误 | 外部补救/续接 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
);
for (const direction of ["A", "B"]) {
  const cases = data.results.filter((r: any) => r.direction === direction);
  const sum = (key: string) => cases.reduce((n: number, r: any) => n + (r[key] ?? 0), 0);
  const repairs = cases.reduce(
    (n: number, r: any) =>
      n +
      r.phases.reduce((s: number, p: any) => s + p.externalRepairs, 0) +
      (r.externalContinuations ?? 0),
    0,
  );
  lines.push(
    `| ${direction} | ${seconds(sum("elapsedMs"))}秒 | ${cases.filter((r: any) => r.passed).length}/${cases.length} | ${sum("validationRuns")} | ${sum("failedChecks")} | ${sum("repeatedPassingChecks")} | ${sum("toolErrors")} | ${repairs} |`,
  );
}
lines.push("", "## 分阶段与协作观察", "");
for (const r of data.results) {
  lines.push(
    `- ${r.label}：${r.phases.length ? r.phases.map((p: any) => `${p.stage} ${seconds(p.elapsedMs)}秒 / ${p.validationRuns}次验证 / ${p.handoffs}次交接`).join("；") : "首轮300秒预算后续接，详见下方"}。`,
  );
  if (r.error) lines.push(`  - 未完成原因：${r.error}`);
  if (r.continuation)
    lines.push(
      `  - 原轮交付超时，已有代码通过；追加一次原会话续接${seconds(r.continuation.elapsedMs)}秒，新增测试${r.continuation.extraValidationRuns ?? "未确认"}次。原始超时保留，续接时间计入本表，测试调度闲置不计。`,
    );
  for (const issue of r.audit.issues) lines.push(`  - 待区分的协作观察：${issue}`);
}
lines.push(
  "",
  "## 证据与边界",
  "",
  "比较仅适用于此版本、渠道、档位、任务和本轮负载。耗时包括模型生成、工具执行与主手复核；累计耗时是各任务相加，不是并发测试的墙钟总时长。长任务是四阶段模块交付，不代表无限长上下文。",
  "",
  "初轮edit审批干扰记录保留在role-swap-1791731186837，不纳入本表。本轮没有待用户审批，测试hash逐档相同，原生session跨任务独立。代码通过不等于已覆盖所有需求边界。",
  "原统计中出现的回执/账本计数告警，包含列目录等普通命令及尚未启动验收器的失败；comparison.audit已按固定验收器PASS/FAIL标记重新核对，保留原始告警，不把它们误判成产品丢失回执。",
  "",
  "- results.json：运行原始统计",
  "- initial-results.json / continuations.json：首次交付与额外续接的独立记录",
  "- comparison.json：从原始事件追加复核的统计",
  "- native-model-evidence.json：原生模型与工具失败摘录",
  "- artifacts.json：生成源码及README",
  "- cleanup.json：临时任务清理证据",
  "",
);
await fs.writeFile(`${root}/comparison.md`, lines.join("\n"));
console.log(
  JSON.stringify(
    data.results.map((r: any) => ({
      label: r.label,
      passed: r.passed,
      seconds: Number(seconds(r.elapsedMs)),
      issues: r.audit.issues,
    })),
  ),
);
