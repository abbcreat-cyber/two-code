import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { configure } from "./two-code-glm-code-fixture.mjs";
import { createCodingFixture, type CodingSize } from "./two-code-coding-fixtures.js";
import { readLedger, stageMetrics, nativeModels, artifacts } from "./two-code-role-swap-metrics.js";
import type { EngineSelection } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/role-swap-${Date.now()}`;
const testedVersion = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")).version;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(`${root}/owner.json`, JSON.stringify({ kind: "two-code-role-swap-qa", root }));
await configure(root);
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const step: EngineSelection = {
  harness: "step-code",
  provider: "step-plan",
  model: "step-5-preview",
  thinking: "medium",
};
const glm: EngineSelection = {
  harness: "claude-code",
  provider: "bigmodel-coding-plan",
  model: "glm-5.3",
  thinking: "max",
};
const owned = new Map<string, string>(),
  answered = new Set<string>();
const results: Record<string, unknown>[] = [],
  permissions: unknown[] = [];
const snapshots: Record<string, unknown> = {},
  productArtifacts: Record<string, unknown> = {};
const fixtureHashes = new Map<CodingSize, string>();
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    let allow = false;
    try {
      allow =
        p.role === "sidekick" &&
        p.title.toLowerCase() === "powershell" &&
        JSON.parse(p.detail).command === owned.get(t.id);
    } catch {}
    permissions.push({ taskId: t.id, role: p.role, tool: p.title, allow });
    void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function flush() {
  await fs.writeFile(
    `${root}/results.json`,
    JSON.stringify(
      {
        version: testedVersion,
        root,
        samplesPerSize: 1,
        results,
        permissions,
        fixtureHashes: Object.fromEntries(fixtureHashes),
      },
      null,
      2,
    ),
  );
  await fs.writeFile(`${root}/native-model-evidence.json`, JSON.stringify(snapshots, null, 2));
  await fs.writeFile(`${root}/artifacts.json`, JSON.stringify(productArtifacts, null, 2));
}
async function turn(taskId: string, text: string) {
  await service.submit({ taskId, text, requestId: randomUUID() });
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const t = await service.read(taskId);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 250));
  }
  await service.cancel(taskId);
  throw Error("本阶段300秒超时，已取消所属任务");
}
async function run(size: CodingSize, direction: "A" | "B") {
  const label = `${direction}-${size}`,
    cwd = `${root}/${label}`;
  const { check, stages } = await createCodingFixture(size, cwd);
  const hash = createHash("sha256").update(check).digest("hex");
  if (fixtureHashes.has(size)) assert.equal(hash, fixtureHashes.get(size));
  else fixtureHashes.set(size, hash);
  const task = await service.create({
    workspacePath: cwd,
    title: `角色对比-${label}`,
    dual: true,
    mode: "yolo",
    lead: direction === "A" ? step : glm,
    sidekick: direction === "A" ? glm : step,
  });
  owned.set(task.id, "");
  const started = Date.now(),
    phases: Record<string, unknown>[] = [];
  let sessions: Array<string | undefined> | undefined;
  let failure: string | undefined;
  try {
    for (const stage of stages) {
      const before = await service.read(task.id),
        seq = before.events.at(-1)?.seq ?? 0;
      const ledgerStart = (await readLedger(cwd)).length;
      const command = `node '${cwd}/check.mjs' ${stage.id}`;
      owned.set(task.id, command);
      const limits = `工作区${cwd}。仅写src内.mjs与README.md。check.mjs和.qa为固定验收器及账本，不得修改删除，不许绕过。禁止联网、安装依赖和修改工作区外文件。主手确定接口范围后，用唯一持久副手实现和验证，主手读取关键代码及真实回执审查，自己不要写实现或重复运行验证。副手使用本底座原生PowerShell工具精确执行以下command，不得加前后缀，包括打印退出码的片段：\n${command}\n失败时修源码后再验证；代码没变且已经通过时不重跑。主手必须拿到副手报告再交付。`;
      const phaseStart = Date.now();
      let done = await turn(task.id, `${stage.brief}\n\n${limits}`);
      await fs.writeFile(
        `${root}/${label}-${stage.id}-attempt1.json`,
        JSON.stringify(done, null, 2),
      );
      assert.equal(done.status, "completed", done.error);
      assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check, "固定验收器被修改");
      let ledger = await readLedger(cwd),
        externalRepairs = 0;
      if (
        ledger.length === ledgerStart ||
        ledger.at(-1)?.phase !== stage.id ||
        !ledger.at(-1)?.passed
      ) {
        const issue =
          ledger.length === ledgerStart ? "没有真实验证记录" : ledger.at(-1)!.error.slice(0, 1800);
        console.log(JSON.stringify({ label, stage: stage.id, outcome: "repair", issue }));
        externalRepairs++;
        done = await turn(
          task.id,
          `本阶段未通过验收：${issue}\n主手读取前次真实回执，向原副手交回具体修复要求，只修实现并按原命令验证，不能改验收器。\n${limits}`,
        );
        await fs.writeFile(
          `${root}/${label}-${stage.id}-attempt2.json`,
          JSON.stringify(done, null, 2),
        );
        assert.equal(done.status, "completed", done.error);
        assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check, "固定验收器被修改");
        ledger = await readLedger(cwd);
      }
      const phaseLedger = ledger.slice(ledgerStart);
      const metrics = stageMetrics(done, seq, phaseLedger);
      const currentSessions = [done.lead.sessionId, done.sidekick.sessionId];
      if (sessions && JSON.stringify(currentSessions) !== JSON.stringify(sessions))
        metrics.issues.push("原生会话在阶段之间变化");
      sessions ??= currentSessions;
      const passed =
        phaseLedger.length > 0 &&
        phaseLedger.at(-1)!.phase === stage.id &&
        phaseLedger.at(-1)!.passed;
      const result = {
        stage: stage.id,
        passed,
        elapsedMs: Date.now() - phaseStart,
        externalRepairs,
        ...metrics,
        ledger: phaseLedger,
      };
      phases.push(result);
      await fs.writeFile(`${root}/${label}-stages.json`, JSON.stringify(phases, null, 2));
      console.log(JSON.stringify({ label, ...result, receipts: undefined, ledger: undefined }));
      assert(passed, "一次补救后仍未通过固定验收");
      assert(metrics.handoffs && metrics.reports, "未完成指定主副手协作");
    }
  } catch (error) {
    failure = String(error);
  } finally {
    if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
    const final = await service.read(task.id);
    await fs.writeFile(`${root}/${label}-final.json`, JSON.stringify(final, null, 2));
    snapshots[label] = await nativeModels(final).catch((e) => ({ error: String(e) }));
    productArtifacts[label] = await artifacts(cwd);
    const ledger = await readLedger(cwd);
    const allMetrics = stageMetrics(final, 0, ledger);
    results.push({
      label,
      size,
      direction,
      taskId: task.id,
      passed: !failure && phases.length === stages.length && phases.every((p) => p.passed),
      error: failure,
      elapsedMs: Date.now() - started,
      phases,
      ...allMetrics,
      usage: final.usage,
      finalStatus: final.status,
      fixtureHash: hash,
    });
    await flush();
    console.log(
      JSON.stringify({
        label,
        finished: true,
        passed: !failure,
        error: failure,
        elapsedMs: Date.now() - started,
      }),
    );
  }
}
console.log(
  JSON.stringify({ root, A: "Step medium主手 / GLM max副手", B: "GLM max主手 / Step medium副手" }),
);
try {
  for (const size of ["small", "medium", "long"] as const)
    await Promise.all([run(size, "A"), run(size, "B")]);
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await flush();
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ at: new Date().toISOString(), taskIds: [...owned.keys()] }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
