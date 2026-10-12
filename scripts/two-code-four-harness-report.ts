import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { profiles, directed } from "./two-code-four-harness-plan.js";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\four-harness-\d+$/.test(root));
const data = JSON.parse(await fs.readFile(`${root}/results.json`, "utf8"));
const evidence = JSON.parse(await fs.readFile(`${root}/native-model-evidence.json`, "utf8"));
const notes = await fs.readFile(`${root}/adjudication.json`, "utf8").then(JSON.parse, () => ({}));
const labels: Record<string, string> = {
  CG: "Claude · GLM max",
  CD: "Claude · 腾讯DS 高",
  CS: "Claude · Step订阅 中",
  PA: "Pi · Astra 中",
  PG: "Pi · GLM max",
  PD: "Pi · 腾讯DS 高",
  PS: "Pi · Step订阅 中",
  SS: "Step · Step订阅 中",
  ZG: "ZCode · GLM max",
};
const keys = Object.keys(profiles);
const caseVersion = (r: any) => r.runVersion ?? data.version;
const versions = [...new Set<string>(data.results.map(caseVersion))];
const mixedVersions = versions.length > 1;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}`;
const at = (a: string, b: string, size: string) =>
  data.results.find((r: any) => r.lead === a && r.side === b && r.size === size);
const cell = (r: any) =>
  !r
    ? "待测"
    : r.passed
      ? `${seconds(r.elapsedMs)}${r.intervention ? "*" : ""}${mixedVersions ? ` [${caseVersion(r)}]` : ""}`
      : `未交付${r.codePassed ? "(代码通过)" : ""} [${caseVersion(r)}]`;
const sessions = new Set();
for (const r of data.results) {
  const t = JSON.parse(await fs.readFile(`${root}/${r.label}-final.json`, "utf8"));
  assert.equal(t.mode, "yolo");
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(`${t.workspacePath}/check.mjs`))
      .digest("hex"),
    r.fixtureHash,
  );
  for (const role of ["lead", "sidekick"]) {
    assert.deepEqual(t[role].selection, profiles[r[role === "lead" ? "lead" : "side"]]);
    if (t[role].sessionId) {
      assert(!sessions.has(t[role].sessionId), "不同任务复用原生会话");
      sessions.add(t[role].sessionId);
    }
  }
  r.evidenceErrors = Object.entries(evidence[r.label] ?? {}).flatMap(([role, n]: [string, any]) =>
    (n.toolFailures ?? []).map((e: any) => ({ role, ...e })),
  );
  r.zcodeHistoryComplete = ["lead", "sidekick"]
    .filter((role) => t[role].selection.harness === "zcode")
    .every((role) => evidence[r.label]?.[role]?.historyComplete === true);
  const unexpectedFiles: string[] = [];
  for (const file of await fs.readdir(t.workspacePath, { withFileTypes: true })) {
    if (["src", ".qa", ".mimosa", "check.mjs", "README.md"].includes(file.name)) continue;
    unexpectedFiles.push(file.name + (file.isDirectory() ? "/" : ""));
  }
  for (const dir of ["src", ".qa"]) {
    for (const file of await fs.readdir(`${t.workspacePath}/${dir}`).catch(() => [])) {
      if (
        dir === "src"
          ? file.endsWith(".mjs")
          : ["ledger.jsonl", "orders.csv", "report.json"].includes(file)
      )
        continue;
      unexpectedFiles.push(`${dir}/${file}`);
    }
  }
  r.unexpectedFiles = unexpectedFiles;
  const zLead = evidence[r.label]?.lead;
  r.leadWriteCallsObserved =
    t.lead.selection.harness === "zcode"
      ? (zLead?.tools ?? []).filter((tool: any) =>
          /^(write|edit|write_file|edit_file|apply_patch|multiedit|notebookedit)$/i.test(
            tool.toolName,
          ),
        ).length
      : r.leadWriteCalls;
  r.coordinationWarnings = [...r.issues];
  if (r.leadWriteCallsObserved && !r.coordinationWarnings.some((s: string) => s.includes("主手")))
    r.coordinationWarnings.push("主手原生历史中存在写入/编辑工具调用，偏离指定分工");
}
const ranking = directed
  .flat()
  .map(([lead, side]) => {
    const small = at(lead!, side!, "small"),
      medium = at(lead!, side!, "medium");
    const cases = [small, medium].filter(Boolean);
    return {
      lead,
      side,
      small,
      medium,
      completed: cases.filter((r) => r.passed).length,
      attempted: cases.length,
      totalMs: cases.reduce((s, r) => s + r.elapsedMs, 0),
      interventions: cases.reduce((s, r) => s + r.intervention, 0),
      nativeToolErrors: cases.reduce((s, r) => s + r.nativeToolErrors, 0),
      sameHarness: profiles[lead!]!.harness === profiles[side!]!.harness,
    };
  })
  .sort((a, b) => b.completed - a.completed || a.totalMs - b.totalMs);
const failures = data.results.filter((r: any) => !r.passed);
const summary = {
  expected: 144,
  finished: data.results.length,
  passed: data.results.filter((r: any) => r.passed).length,
  failed: failures.length,
  firstCheckPassed: data.results.filter((r: any) => r.firstCheckPassed).length,
  permissions: data.permissionRequests.length,
  interventions: data.results.reduce((n: number, r: any) => n + r.intervention, 0),
  repeatedChecks: data.results.reduce((n: number, r: any) => n + r.repeatedPassingChecks, 0),
  scopeWarnings: data.results.filter((r: any) => r.unexpectedFiles.length).length,
  coordinationWarnings: data.results.filter((r: any) => r.coordinationWarnings.length).length,
};
const sameModel: any[] = [];
for (const [model, group] of [
  ["GLM-5.3 max", ["CG", "PG", "ZG"]],
  ["Step-5订阅 中", ["CS", "PS", "SS"]],
  ["腾讯DeepSeek 高", ["CD", "PD"]],
] as const) {
  const partners = keys.filter((k) => !(group as readonly string[]).includes(k));
  for (const role of ["lead", "side"])
    for (const id of group) {
      const cases = data.results.filter(
        (r: any) => r[role] === id && partners.includes(r[role === "lead" ? "side" : "lead"]),
      );
      const passed = cases.filter((r: any) => r.passed);
      sameModel.push({
        model,
        role,
        id,
        partners,
        expected: partners.length * 2,
        finished: cases.length,
        passed: passed.length,
        averageMs: passed.length
          ? passed.reduce((sum: number, r: any) => sum + r.elapsedMs, 0) / passed.length
          : null,
      });
    }
}
const lines = [
  "# 四脚手架九配置真实对比",
  "",
  `运行版本 ${versions.join(" / ")}；截至报告生成，完成 ${summary.finished}/144，交付通过 ${summary.passed}，未交付 ${summary.failed}。`,
  ...versions.map(
    (v) => `版本 ${v}：${data.results.filter((r: any) => caseVersion(r) === v).length}项。`,
  ),
  ...(data.transitions ?? []).map(
    (t: any) => `版本分界：完成 ${t.afterCases} 项后，${t.from} → ${t.to}（${t.at}）；${t.reason}。`,
  ),
  "按用户要求，之前已完成的85项保留、不重跑，修复后仅继续剩余项。跨版本耗时仅供观察，不作为同版本公平排名；表格方括号标明运行版本。",
  `全部完全访问；用户审批请求 ${summary.permissions}，外部修复/续接 ${summary.interventions}，重复通过验证 ${summary.repeatedChecks}。`,
  "",
  "## 配置",
  "",
  ...keys.map((k) => `- ${k}：${labels[k]}`),
  "",
  "Step“开思考”取medium。腾讯DS请求兼容别名claude-sonnet-4-8，本机路由明确指向deepseek-v4.1-flash，不是Claude模型。",
  "",
];
for (const size of ["small", "medium"]) {
  lines.push(
    `## ${size === "small" ? "小" : "中"}任务：主手行 → 副手列（秒）`,
    "",
    `|主手\\副手|${keys.join("|")}|`,
    `|---|${keys.map(() => "---:").join("|")}|`,
  );
  for (const a of keys)
    lines.push(`|${a}|${keys.map((b) => (a === b ? "—" : cell(at(a, b, size)))).join("|")}|`);
  lines.push("");
}
lines.push(
  "## 完成两档任务的组合",
  "",
  "|主手 → 副手|小任务秒|中任务秒|合计秒|外部干预|原生工具错误|",
  "|---|---:|---:|---:|---:|---:|",
);
for (const r of ranking.filter((r) => r.completed === 2))
  lines.push(
    `|${labels[r.lead!]} → ${labels[r.side!]}${r.sameHarness ? "（同脚手架）" : ""}|${cell(r.small)}|${cell(r.medium)}|${seconds(r.totalMs)}|${r.interventions}|${r.nativeToolErrors}|`,
  );
lines.push(
  "",
  "## 同模型换脚手架：仅比较共同搭档",
  "",
  "每个模型组均排除组内配置作为搭档，使各脚手架面对相同的其他搭档和两档任务。平均值只计算成功任务，必须同时看完成率；未测齐时不据均值排名。",
  "",
  "|模型组|角色|配置|已测/应测|交付通过|成功项平均秒|",
  "|---|---|---|---:|---:|---:|",
);
for (const r of sameModel)
  lines.push(
    `|${r.model}|${r.role === "lead" ? "主手" : "副手"}|${labels[r.id]}|${r.finished}/${r.expected}|${r.passed}|${r.averageMs == null ? "—" : seconds(r.averageMs)}|`,
  );
lines.push("", "## 失败和协作观察", "");
for (const r of data.results.filter(
  (r: any) =>
    !r.passed ||
    r.intervention ||
    r.repeatedPassingChecks ||
    r.nativeToolErrors ||
    r.coordinationWarnings.length ||
    r.unexpectedFiles.length,
)) {
  lines.push(
    `- ${r.label}：${r.passed ? "交付通过" : "未交付"}；${String(r.error ?? "")
      .replace(/\r?\n/g, " ")
      .slice(
        0,
        350,
      )} 原生工具错误${r.nativeToolErrors}，重复验证${r.repeatedPassingChecks}，外部干预${r.intervention}。`,
  );
  for (const issue of r.coordinationWarnings) lines.push(`  - ${issue}`);
  if (r.unexpectedFiles.length)
    lines.push(
      `  - 待核对的范围外产物：${r.unexpectedFiles.join("、")}（.mimosa为原生运行时目录，已排除）。`,
    );
  for (const e of r.evidenceErrors)
    lines.push(
      `  - ${e.role} ${e.name ?? e.toolName ?? "工具"}：${JSON.stringify(e.output ?? e.error ?? "")
        .replace(/\r?\n/g, " ")
        .slice(0, 180)}`,
    );
}
lines.push(
  "",
  "## 判读与边界",
  "",
  ...Object.values(notes).map((n) => `- ${n}`),
  "- 每格只有一项样本。最多4项并发，同一配置同时只占一项；首8项按完整批次，之后空闲位置及时接续。同模型共享上游仍可能影响耗时。排名优先完整交付，不将超时或失败的短耗时算优势。",
  "- 小任务是去重函数；中任务是CSV、金额聚合和CLI，统一增加非首列引号测试。首次最多600秒，统一至多一次300秒修复/续接，耗时累计；星号表示发生外部干预。",
  "- 原生工具错误包含不存在文件、预期非法输入和未执行门禁，不能直接视作适配故障。ZCode以V4原生历史取证，model身份依据原生配置与实际完成turn，不冒充捕获了上游HTTP报文。历史窗口不完整时不能声称已审完全部工具。",
  "- 代码通过与范围合规分开；自动统计未声称全面验证所有任务范围。未跑长任务、视觉、浏览器或前端UI。",
  "- results.json保存每格初次状态、用量、补救、真实ledger；native-model-evidence.json保留原生证据；artifacts.json保留源码。",
  "",
);
await fs.writeFile(`${root}/comparison.md`, lines.join("\n"));
await fs.writeFile(
  `${root}/comparison.json`,
  JSON.stringify(
    {
      summary,
      versions,
      transitions: data.transitions ?? [],
      labels,
      ranking: ranking.map(({ small, medium, ...r }) => ({
        ...r,
        smallMs: small?.elapsedMs,
        mediumMs: medium?.elapsedMs,
        smallVersion: small && caseVersion(small),
        mediumVersion: medium && caseVersion(medium),
      })),
      failures,
      sameModel,
      notes,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
const report = path.join("D:/Apps/TwoCode/reports", path.basename(root));
await fs.mkdir(report, { recursive: true });
await fs.copyFile(`${root}/comparison.md`, path.join(report, "comparison.md"));
await fs.copyFile(`${root}/comparison.json`, path.join(report, "comparison.json"));
