import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readLedger, stageMetrics, nativeModels } from "./two-code-role-swap-metrics.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\three-harness-\d+$/.test(root));
const owner = JSON.parse(await fs.readFile(`${root}/owner.json`, "utf8"));
assert.equal(owner.kind, "two-code-three-harness-qa");
await fs.access(`${root}/closed.json`);
const data = JSON.parse(await fs.readFile(`${root}/results.json`, "utf8"));
const adjudication: Record<
  string,
  Array<{ category: string; finding: string; evidence: string }>
> = await fs.readFile(`${root}/adjudication.json`, "utf8").then(JSON.parse, (error) => {
  if (error.code === "ENOENT") return {};
  throw error;
});
const sessions = new Set<string>(),
  native: Record<string, any> = {};
for (const r of data.results) {
  const t: TwoCodeTask = JSON.parse(await fs.readFile(`${root}/${r.label}-final.json`, "utf8"));
  assert.equal(t.mode, "yolo");
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(`${t.workspacePath}/check.mjs`))
      .digest("hex"),
    r.fixtureHash,
    "固定验收器发生变化",
  );
  const ledger = await readLedger(t.workspacePath);
  r.audit = stageMetrics(t, 0, ledger);
  native[r.label] = await nativeModels(t);
  for (const role of ["lead", "sidekick"] as const) {
    const actor = t[role],
      expected = data.profiles[r.pair[role === "lead" ? 0 : 1]];
    assert.deepEqual(actor.selection, expected);
    if (r.passed) assert(actor.actualModel?.endsWith(expected.model));
    if (actor.sessionId) {
      if (actor.selection.harness !== "claude-code")
        assert(
          path
            .resolve(actor.sessionId)
            .toLowerCase()
            .startsWith(root.toLowerCase() + path.sep),
          "Pi/Step原生会话必须位于本轮QA目录",
        );
      assert(!sessions.has(actor.sessionId), "跨任务复用了原生会话");
      sessions.add(actor.sessionId);
    }
  }
}
assert.equal(data.permissionRequests.length, 0, "完全访问不应出现待用户审批");
const names: Record<string, string> = { C: "Claude", P: "Pi", S: "Step" };
const pairs = ["CP", "PS", "SC", "PC", "SP", "CS"];
const rankings = pairs
  .map((pair) => {
    const cases = data.results.filter((r: any) => r.pair === pair);
    const sum = (key: string) => cases.reduce((n: number, r: any) => n + (r[key] ?? 0), 0);
    return {
      pair,
      name: `${names[pair[0]]} → ${names[pair[1]]}`,
      completed: cases.filter((r: any) => r.passed).length,
      expected: 2,
      totalMs: sum("elapsedMs"),
      firstPassed: cases.filter((r: any) => r.firstCheckPassed).length,
      interventions: sum("intervention"),
      toolErrors: sum("toolErrors"),
      repeated: sum("repeatedPassingChecks"),
      cooperationIssues: cases.flatMap((r: any) => r.audit.issues),
      cases,
    };
  })
  .sort((a, b) => b.completed - a.completed || a.totalMs - b.totalMs);
data.rankings = rankings.map(({ cases: _cases, ...r }) => r);
data.adjudication = adjudication;
await fs.writeFile(`${root}/comparison.json`, JSON.stringify(data, null, 2));
await fs.writeFile(`${root}/native-model-evidence.json`, JSON.stringify(native, null, 2));
const time = (ms: number) => `${(ms / 1000).toFixed(1)}秒`;
const cell = (r: any) => (r ? `${time(r.elapsedMs)}${r.passed ? "" : "（未交付）"}` : "未测");
const best = rankings.find((r) => r.completed === 2);
const lines = [
  "# 三脚手架主副互换：小、中任务对比",
  "",
  `运行基线：Two Code ${data.version}；全部完全访问，每格一项新任务。箭头从主手指向副手。`,
  "",
  "- Claude：GLM-5.3 max",
  "- Pi：GPT-6 Astra medium，现有ChatGPT套餐连接",
  "- Step：Step 5订阅 medium",
  "",
  best
    ? `本轮已完成两档任务的组合中，累计执行耗时最少：**${best.name}**（${time(best.totalMs)}）。这是组合实测，不是纯模型或纯脚手架排名。`
    : "本轮没有组合完整通过两档任务，不能据耗时给出胜者。",
  "",
  "| 主手 → 副手 | 小任务 | 中任务 | 合计 | 代码及交付 | 首次验证通过 | 工具报错 | 补救/续接 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
];
for (const r of rankings)
  lines.push(
    `| ${r.name} | ${cell(r.cases.find((c: any) => c.size === "small"))} | ${cell(r.cases.find((c: any) => c.size === "medium"))} | ${time(r.totalMs)} | ${r.completed}/2 | ${r.firstPassed}/2 | ${r.toolErrors} | ${r.interventions} |`,
  );
lines.push("", "## 运行中观察", "");
for (const r of data.results) {
  lines.push(
    `- ${r.label}：交接${r.handoffs}次、报告${r.reports}次、实际测试${r.validationRuns}次、失败测试${r.failedChecks}次、重复通过验证${r.repeatedPassingChecks}次、主手文件修改${r.leadWriteCalls}次。`,
  );
  if (r.error) lines.push(`  - 未交付原因：${r.error}`);
  if (r.intervention)
    lines.push(
      `  - 发生${r.interventionKind}，首轮状态和耗时保存在results.json，补救耗时已计入合计。`,
    );
  for (const issue of r.audit.issues) lines.push(`  - 协作观察：${issue}`);
  for (const note of adjudication[r.label] ?? [])
    lines.push(`  - 人工复核【${note.category}】：${note.finding} 证据：${note.evidence}`);
  for (const role of ["lead", "sidekick"])
    for (const issue of native[r.label]?.[role]?.toolFailures ?? [])
      lines.push(
        `  - ${role} ${issue.name}失败：${String(issue.output).replace(/\r?\n/g, " ").slice(0, 220)}`,
      );
}
lines.push(
  "",
  "## 方法与边界",
  "",
  "代码及交付通过不代表范围完全合规；范围偏差单列于人工复核。工具报错为原始次数，包括预期非法输入及不存在的文件探测，不等于适配故障数。开场门禁未执行尝试不计入实际工具错误，原生日志仍会保留对应失败提示。",
  "",
  "小任务为去重函数修复；中任务为CSV解析、整数金额汇总及CLI。每档验收器hash相同，所有命令使用相对工作区路径，脚手架自行选择原生命令工具，因此不与上一轮Windows绝对路径测试的耗时混排。主手规划及审查，副手实现和验证；统计以真实ledger、文件hash及原生回执为准。",
  "",
  "每批3组构成主副环，三个模型各当一次主手和副手，两个环分别运行；首次600秒，统一至多一次300秒补救/续接。各格只有一次样本，速度包含提供方网络、推理和底座/交接成本，不表示长期稳定排名。若两组差距很小，应视为接近。没有修改正式默认组合。",
  "",
  "comparison.json保存复核结果，native-model-evidence.json保存原生模型与工具错误，artifacts.json保存产物，cleanup.json记录清理。",
  "",
);
await fs.writeFile(`${root}/comparison.md`, lines.join("\n"));
console.log(JSON.stringify(data.rankings));
