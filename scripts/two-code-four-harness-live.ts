import { runMatrixQueue } from "./two-code-matrix-scheduler.js";
import { matrixEvidence } from "./two-code-four-harness-evidence.js";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { nativeConnections } from "../packages/services/src/two-code/adapters/native-connections.js";
import { createCodingFixture } from "./two-code-coding-fixtures.js";
import { readLedger, stageMetrics, artifacts } from "./two-code-role-swap-metrics.js";
import { profiles, directed } from "./two-code-four-harness-plan.js";

const root = path.resolve(
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
    `D:/Apps/TwoCode/qa/four-harness-${Date.now()}`,
);
assert(/^D:\\Apps\\TwoCode\\qa\\four-harness-\d+$/.test(root));
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
if (!(await exists(`${root}/owner.json`))) {
  await fs.mkdir(`${root}/data/.zcode/v2`, { recursive: true });
  await fs.writeFile(
    `${root}/owner.json`,
    JSON.stringify({ kind: "two-code-four-harness-qa", root }),
  );
  const saved = JSON.parse(
    await fs.readFile("D:/Apps/TwoCode/data/model-connections.json", "utf8"),
  );
  const connections = new Map((await nativeConnections()).map((c) => [c.id, c]));
  for (const c of saved.connections) connections.set(c.id, c);
  const wanted = [...connections.values()].filter((c) =>
    Object.values(profiles).some(
      (p) => p.harness === c.harness && (p.provider ?? "") === c.provider,
    ),
  );
  await fs.writeFile(
    `${root}/data/model-connections.json`,
    JSON.stringify({ revision: randomUUID(), connections: wanted, deleted: [] }),
    { mode: 0o600 },
  );
  await fs.copyFile(
    "D:/Apps/TwoCode/data/chatgpt-connection.json",
    `${root}/data/chatgpt-connection.json`,
  );
  await fs.copyFile(
    "D:/Apps/TwoCode/data/.zcode/v2/provider_config.json",
    `${root}/data/.zcode/v2/provider_config.json`,
  );
}
const owner = JSON.parse(await fs.readFile(`${root}/owner.json`, "utf8"));
assert.equal(owner.kind, "two-code-four-harness-qa");
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
process.env.ZCODE_HOME = `${root}/data/.zcode`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IZCodeAgentService, IProviderSettingsService } =
  await import("../packages/services/src/index.js");
const nativeCLI = path.resolve("packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  zcodeAgentCommandResolver: () => ({
    command: process.execPath,
    args: [nativeCLI, "app-server", "--stdio"],
    env: { ZCODE_HOME: process.env.ZCODE_HOME! },
  }),
});
const service = services.get(ITwoCodeService),
  agent = services.get(IZCodeAgentService);
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();
const prior = (await exists(`${root}/results.json`))
  ? JSON.parse(await fs.readFile(`${root}/results.json`, "utf8"))
  : undefined;
if (prior && prior.version !== version) {
  assert(process.argv.includes("--continue-after-fix"), "跨版本继续必须显式标记修复边界");
  assert(await exists(`${root}/closed.json`), "上一阶段必须已经关闭");
}
const results: any[] = prior?.results ?? [];
for (const r of results) {
  r.runVersion ??= prior.version;
  r.runRevision ??= prior.revision;
}
const transitions = prior?.transitions ?? [];
if (prior && prior.version !== version)
  transitions.push({
    from: prior.version,
    to: version,
    afterCases: results.length,
    at: new Date().toISOString(),
    reason: "用户要求修复ZCode后只继续未测任务，保留既有成绩、不重跑",
  });
const native: Record<string, any> = (await exists(`${root}/native-model-evidence.json`))
  ? JSON.parse(await fs.readFile(`${root}/native-model-evidence.json`, "utf8"))
  : {};
const outputs: Record<string, any> = (await exists(`${root}/artifacts.json`))
  ? JSON.parse(await fs.readFile(`${root}/artifacts.json`, "utf8"))
  : {};
const hashes: Record<string, string> = prior?.fixtureHashes ?? {};
const owned = new Set<string>(results.map((r) => r.taskId));
const permissions = new Set<string>(prior?.permissionRequests ?? []);
let stopped = false,
  tail: Promise<unknown> = Promise.resolve();
const subscription = service.onDidChange((t) => {
  if (owned.has(t.id)) for (const p of t.permissions) permissions.add(`${t.id}:${p.id}:${p.title}`);
});
function flush() {
  const docs = [
    [
      "results.json",
      {
        root,
        version,
        transitions,
        revision: prior?.revision ?? revision,
        profiles,
        expected: 144,
        concurrency: 4,
        fixtureHashes: hashes,
        permissionRequests: [...permissions],
        results,
      },
    ],
    ["native-model-evidence.json", native],
    ["artifacts.json", outputs],
  ].map(([name, data]) => [name, JSON.stringify(data, null, 2)]);
  tail = tail.then(async () => {
    for (const [name, data] of docs) await fs.writeFile(`${root}/${name}`, data!);
  });
  return tail;
}
async function turn(id: string, text: string, budget: number) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const deadline = Date.now() + budget;
  let t = await service.read(id);
  while (t.status === "running" && Date.now() < deadline) {
    if (await exists(`${root}/STOP`)) {
      stopped = true;
      return { task: await service.cancel(id), timedOut: false };
    }
    await new Promise((r) => setTimeout(r, 400));
    t = await service.read(id);
  }
  return {
    task: t.status === "running" ? await service.cancel(id) : t,
    timedOut: t.status === "running",
  };
}
async function run(size: "small" | "medium", [lead, side]: string[]) {
  const label = `${lead}-${side}-${size}`,
    cwd = `${root}/${label}`;
  if (results.some((r) => r.label === label)) return;
  const fixture = await createCodingFixture(size, cwd);
  if (size === "medium") {
    fixture.check = fixture.check.replace(
      "const rows=parseCsv(input);",
      `assert.deepEqual(parseCsv('item,note\\nx,"a,b\\nc"\\n'),[{item:'x',note:'a,b\\nc'}]);assert.throws(()=>parseCsv('item,note\\nx,"unfinished'));\nconst rows=parseCsv(input);`,
    );
    await fs.writeFile(`${cwd}/check.mjs`, fixture.check);
  }
  const fixtureHash = hash(fixture.check);
  if (hashes[size]) assert.equal(hashes[size], fixtureHash);
  else hashes[size] = fixtureHash;
  const task = await service.create({
    workspacePath: cwd,
    title: `四底座-${label}`,
    dual: true,
    mode: "yolo",
    lead: profiles[lead!]!,
    sidekick: profiles[side!]!,
  });
  owned.add(task.id);
  const start = Date.now();
  console.log(JSON.stringify({ start: label, taskId: task.id }));
  let failure: string | undefined,
    first: unknown,
    intervention = 0,
    interventionKind: string | undefined;
  const limits =
    "仅修改src/*.mjs和README.md；不得修改/删除/绕过check.mjs及.qa，不联网不安装依赖，不写工作区外文件。主手定接口并派唯一副手实现和验证，自己读源码/原始回执审查，不直接实现、不重复验证。副手用本底座原生命令工具执行原样命令node check.mjs all，不拼接echo退出码；源码未变且通过不重跑。必须收到副手报告才交付。";
  try {
    const attempt = await turn(task.id, fixture.stages[0]!.brief + "\n" + limits, 600000);
    await fs.writeFile(`${root}/${label}-attempt1.json`, JSON.stringify(attempt.task, null, 2));
    const ledger = await readLedger(cwd);
    first = {
      status: attempt.task.status,
      error: attempt.task.error,
      timedOut: attempt.timedOut,
      elapsedMs: Date.now() - start,
      codePassed: ledger.at(-1)?.passed === true,
    };
    assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture.check);
    if (
      !stopped &&
      ((attempt.task.status === "completed" && !ledger.at(-1)?.passed) ||
        (attempt.timedOut && ledger.at(-1)?.passed))
    ) {
      intervention = 1;
      interventionKind = ledger.at(-1)?.passed ? "continuation" : "repair";
      const text =
        interventionKind === "continuation"
          ? "继续既有副手报告后的复核交付，不要重复已通过的测试。"
          : `固定测试尚未通过：${ledger.at(-1)?.error ?? "没有真实验收记录"}。请主手把问题交回原副手修复验证。`;
      await turn(task.id, text + "\n" + limits, 300000);
    }
    const done = await service.read(task.id),
      finalLedger = await readLedger(cwd);
    assert.equal(done.status, "completed", done.error ?? "未完成");
    assert(finalLedger.at(-1)?.passed, "固定代码验证未通过");
    assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture.check);
    const files = (await fs.readdir(`${cwd}/src`)).filter((n) => n.endsWith(".mjs")).sort();
    const source = await Promise.all(
      files.map(async (n) => [n, await fs.readFile(`${cwd}/src/${n}`, "utf8")]),
    );
    assert.equal(hash(JSON.stringify(source)), finalLedger.at(-1)!.hash, "源码改动后未重验");
    const m = stageMetrics(done, 0, finalLedger);
    assert(m.handoffs && m.reports, "缺少真实主副交接");
  } catch (e) {
    failure = String(e);
  } finally {
    let done = await service.read(task.id);
    if (done.status === "running") done = await service.cancel(task.id);
    await fs.writeFile(`${root}/${label}-final.json`, JSON.stringify(done, null, 2));
    try {
      native[label] = await matrixEvidence(done, agent, root);
    } catch (e) {
      native[label] = { error: String(e) };
      failure ??= `原生证据缺失: ${String(e)}`;
    }
    const ledger = await readLedger(cwd),
      m = stageMetrics(done, 0, ledger);
    const zRole =
      done.lead.selection.harness === "zcode"
        ? "lead"
        : done.sidekick.selection.harness === "zcode"
          ? "sidekick"
          : undefined;
    const zcodeMetricsPartial = !!zRole && !done[zRole].actualModel;
    if (zcodeMetricsPartial) {
      // ZCode尚未投影统一verification/tool_end，真实原生工具事实另列，不能把缺失冒充零错误。
      m.issues = m.issues.filter((i) => i !== "已执行回执与真实测试账本次数不一致");
    }
    for (const role of ["lead", "sidekick"] as const) {
      const a = done[role],
        n = native[label]?.[role];
      const expected =
        a.selection.harness === "zcode"
          ? "glm-5.3"
          : a.selection.model === "claude-sonnet-4-8"
            ? "claude-sonnet-4-8"
            : a.selection.model;
      if (
        !n?.models?.some(
          (v: string) =>
            v.toLowerCase() === expected?.toLowerCase() ||
            (expected === "claude-sonnet-4-8" && v === "deepseek-v4.1-flash"),
        )
      )
        failure ??= `${role}原生模型身份不符或未产生响应`;
    }
    outputs[label] = await artifacts(cwd);
    results.push({
      label,
      runVersion: version,
      runRevision: revision,
      lead,
      side,
      size,
      taskId: task.id,
      passed: !failure,
      error: failure,
      elapsedMs: Date.now() - start,
      first,
      intervention,
      interventionKind,
      finalStatus: done.status,
      codePassed: ledger.at(-1)?.passed === true,
      fixtureHash,
      ledger,
      ...m,
      nativeToolErrors: Object.values(native[label] ?? {}).reduce(
        (sum: number, n: any) => sum + (n.toolFailures?.length ?? 0),
        0,
      ),
      zcodeMetricsPartial,
      usage: done.usage,
    });
    await flush();
    console.log(
      JSON.stringify({
        done: label,
        passed: !failure,
        error: failure,
        elapsedMs: Date.now() - start,
        count: results.length,
      }),
    );
    if (zRole) await agent.disposeWorkspace({ workspacePath: cwd });
  }
}
console.log(JSON.stringify({ root, version, profiles, resumed: results.length }));
await fs.rm(`${root}/closed.json`, { force: true });
try {
  const catalog = await service.catalog();
  for (const p of Object.values(profiles).filter((p) => p.harness !== "zcode"))
    assert(
      catalog
        .find((h) => h.id === p.harness)
        ?.models.some((m) => m.id === p.model && (m.provider ?? "") === (p.provider ?? "")),
      "指定模型不在目录",
    );
  const provider = services.get(IProviderSettingsService);
  const z = await provider.resolveModelConfig({ providerId: "bigmodel-api", modelId: "GLM-5.3" });
  await fs.writeFile(
    `${root}/zcode-capabilities.json`,
    JSON.stringify(
      {
        issues: z.issues,
        properties: z.effectiveConfig.properties,
        optionSpecs: z.effectiveConfig.optionSpecs,
      },
      null,
      2,
    ),
  );
  assert(z.effectiveConfig.optionSpecs?.reasoningLevel?.values?.includes("max"), "ZCode未暴露max");
  const maxRounds = Number(
    process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? Infinity,
  );
  const stop = async () =>
    stopped || (await exists(root + "/STOP")) || (await exists(root + "/PAUSE"));
  for (const size of ["small", "medium"] as const) {
    const jobs = directed
      .flat()
      .filter(([a, b]) => !results.some((r) => r.label === a + "-" + b + "-" + size))
      .slice(0, maxRounds * 4)
      .map((pair) => ({ pair }));
    await runMatrixQueue(jobs, ({ pair }) => run(size, pair), stop, 4);
    if ((await stop()) || Number.isFinite(maxRounds)) break;
  }
} finally {
  subscription.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await flush();
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({
      at: new Date().toISOString(),
      taskIds: [...owned],
      stopped,
      complete: results.length === 144,
    }),
  );
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
