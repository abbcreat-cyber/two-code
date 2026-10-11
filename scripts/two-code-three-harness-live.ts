import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { configure } from "./two-code-glm-code-fixture.mjs";
import { createCodingFixture } from "./two-code-coding-fixtures.js";
import { readLedger, stageMetrics, nativeModels, artifacts } from "./two-code-role-swap-metrics.js";
import type { EngineSelection } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/three-harness-${Date.now()}`;
const version = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")).version;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-three-harness-qa", root }),
);
await configure(root);
await fs.copyFile(
  "D:/Apps/TwoCode/data/chatgpt-connection.json",
  `${root}/data/chatgpt-connection.json`,
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
const profiles: Record<string, EngineSelection> = {
  C: {
    harness: "claude-code",
    provider: "bigmodel-coding-plan",
    model: "glm-5.3",
    thinking: "max",
  },
  P: { harness: "pi", provider: "two-code-chatgpt", model: "gpt-6-astra", thinking: "medium" },
  S: { harness: "step-code", provider: "step-plan", model: "step-5-preview", thinking: "medium" },
};
const owned = new Set<string>(),
  permissions = new Set<string>();
const results: Record<string, any>[] = [];
const native: Record<string, unknown> = {},
  outputs: Record<string, unknown> = {};
const hashes = new Map<string, string>();
let stopped = false,
  writeTail: Promise<unknown> = Promise.resolve();
const sub = service.onDidChange((t) => {
  if (owned.has(t.id)) for (const p of t.permissions) permissions.add(`${t.id}:${p.id}:${p.title}`);
});
function flush() {
  const document = JSON.stringify(
    {
      version,
      root,
      mode: "yolo",
      profiles,
      firstBudgetMs: 600000,
      retryBudgetMs: 300000,
      samplesPerCell: 1,
      fixtureHashes: Object.fromEntries(hashes),
      results,
      permissionRequests: [...permissions],
    },
    null,
    2,
  );
  const modelText = JSON.stringify(native, null, 2),
    artifactText = JSON.stringify(outputs, null, 2);
  writeTail = writeTail.then(async () => {
    await fs.writeFile(`${root}/results.json`, document);
    await fs.writeFile(`${root}/native-model-evidence.json`, modelText);
    await fs.writeFile(`${root}/artifacts.json`, artifactText);
  });
  return writeTail;
}
async function turn(id: string, text: string, budget: number) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const end = Date.now() + budget;
  while (Date.now() < end) {
    if (
      await fs.access(`${root}/STOP`).then(
        () => true,
        () => false,
      )
    ) {
      stopped = true;
      await service.cancel(id);
      throw Error("已按STOP停止本轮");
    }
    const t = await service.read(id);
    if (t.status !== "running") return { task: t, timedOut: false };
    await new Promise((r) => setTimeout(r, 300));
  }
  return { task: await service.cancel(id), timedOut: true };
}
async function run(size: "small" | "medium", pair: string) {
  const label = `${pair}-${size}`,
    cwd = `${root}/${label}`;
  const fixture = await createCodingFixture(size, cwd);
  const fixtureHash = createHash("sha256").update(fixture.check).digest("hex");
  if (hashes.has(size)) assert.equal(hashes.get(size), fixtureHash);
  else hashes.set(size, fixtureHash);
  const task = await service.create({
    workspacePath: cwd,
    title: `三脚手架-${label}`,
    dual: true,
    mode: "yolo",
    lead: profiles[pair[0]],
    sidekick: profiles[pair[1]],
  });
  owned.add(task.id);
  const start = Date.now();
  let failure: string | undefined,
    intervention = 0,
    interventionKind: string | undefined;
  let first: unknown, firstModels: Array<string | undefined> | undefined;
  const limits = `当前工作区为${cwd}，所有相对路径以此为根。仅修改src/*.mjs和README.md；check.mjs及.qa是固定验收器和账本，不得修改、删除、绕过。不要联网、安装依赖或修改工作区外文件。主手确定接口并交唯一副手实现与验证，自己读关键源码和真实回执审查，不直接写实现、不重复跑测试。副手使用本脚手架合适的原生命令工具，在当前工作区执行且不添加前后缀：node check.mjs all。不要为打印退出码再拼接echo。测试失败只修源码再验证；源码没变且已经通过不重跑。主手必须收到副手报告后才能交付，报告简短。`;
  try {
    const started = await turn(task.id, `${fixture.stages[0].brief}\n\n${limits}`, 600000);
    await fs.writeFile(`${root}/${label}-attempt1.json`, JSON.stringify(started.task, null, 2));
    assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture.check, "固定验收器被修改");
    let ledger = await readLedger(cwd);
    firstModels = [started.task.lead.sessionId, started.task.sidekick.sessionId];
    first = {
      status: started.task.status,
      timedOut: started.timedOut,
      error: started.task.error,
      elapsedMs: Date.now() - start,
      codePassed: ledger.at(-1)?.passed === true,
    };
    const codePassed = ledger.at(-1)?.passed === true;
    if (
      !stopped &&
      ((started.task.status === "completed" && !codePassed) || (started.timedOut && codePassed))
    ) {
      intervention = 1;
      interventionKind = codePassed ? "continuation" : "repair";
      const issue = ledger.length ? ledger.at(-1)!.error.slice(0, 1600) : "没有真实测试记录";
      const feedback = codePassed
        ? "继续完成未结束的主手复核和交付，沿用原分工。先核对已有报告及原生回执，代码和输入未变且已通过时不要重跑。"
        : `固定验收未通过：${issue}。主手读取原始回执，把具体问题交回同一副手修复，再按原命令验证。`;
      console.log(JSON.stringify({ label, intervention: interventionKind }));
      const second = await turn(task.id, `${feedback}\n${limits}`, 300000);
      await fs.writeFile(`${root}/${label}-attempt2.json`, JSON.stringify(second.task, null, 2));
      assert.deepEqual(
        [second.task.lead.sessionId, second.task.sidekick.sessionId],
        firstModels,
        "补救更换了原生会话",
      );
      assert.equal(second.task.status, "completed", second.task.error ?? "补救超时");
    } else assert.equal(started.task.status, "completed", started.task.error ?? "首轮超时");
    const done = await service.read(task.id);
    ledger = await readLedger(cwd);
    assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture.check, "固定验收器被修改");
    assert(ledger.length && ledger.at(-1)?.passed, "缺少最终通过的固定验证");
    const files = (await fs.readdir(`${cwd}/src`)).filter((n) => n.endsWith(".mjs")).sort();
    const source = await Promise.all(
      files.map(async (n) => [n, await fs.readFile(`${cwd}/src/${n}`, "utf8")]),
    );
    assert.equal(
      createHash("sha256").update(JSON.stringify(source)).digest("hex"),
      ledger.at(-1)?.hash,
      "代码修改后没有重验",
    );
    const metrics = stageMetrics(done, 0, ledger);
    assert(metrics.handoffs && metrics.reports, "没有实际主副手交接");
    for (const actor of [done.lead, done.sidekick]) {
      assert(actor.actualModel?.endsWith(actor.selection.model!), "实际模型身份不符");
      assert.equal(
        actor.selection.thinking,
        actor.selection.harness === "claude-code" ? "max" : "medium",
      );
    }
  } catch (error) {
    failure = String(error);
  } finally {
    if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
    const done = await service.read(task.id),
      ledger = await readLedger(cwd);
    const metrics = stageMetrics(done, 0, ledger);
    await fs.writeFile(`${root}/${label}-final.json`, JSON.stringify(done, null, 2));
    native[label] = await nativeModels(done).catch((e) => ({ error: String(e) }));
    outputs[label] = await artifacts(cwd);
    const result = {
      label,
      pair,
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
      ...metrics,
      usage: done.usage,
      fixtureHash,
      ledger,
    };
    results.push(result);
    await flush();
    console.log(
      JSON.stringify({
        ...result,
        first: undefined,
        usage: undefined,
        receipts: undefined,
        ledger: undefined,
      }),
    );
  }
}
console.log(JSON.stringify({ root, profiles, version }));
try {
  const catalog = await service.catalog();
  for (const p of Object.values(profiles))
    assert(
      catalog
        .find((h) => h.id === p.harness)
        ?.models.some((m) => m.id === p.model && m.provider === p.provider),
      "指定模型不在当前目录中",
    );
  for (const size of ["small", "medium"] as const)
    for (const pairs of [
      ["CP", "PS", "SC"],
      ["PC", "SP", "CS"],
    ]) {
      if (
        stopped ||
        (await fs.access(`${root}/STOP`).then(
          () => true,
          () => false,
        ))
      ) {
        stopped = true;
        break;
      }
      await Promise.all(pairs.map((pair) => run(size, pair)));
    }
} finally {
  sub.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await flush();
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ at: new Date().toISOString(), taskIds: [...owned], stopped }),
  );
  if (stopped || results.some((r) => !r.passed)) process.exitCode = 1;
}
