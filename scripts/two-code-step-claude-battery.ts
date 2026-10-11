import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";

const root = `D:/Apps/TwoCode/qa/step-claude-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = path.join(root, "data");
process.env.ZCODE_DATA_BASE_DIR = path.join(root, "data");
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const answered = new Set<string>();
const owned = new Map<string, string>();
const progress: Record<string, any>[] = [];
let saving = Promise.resolve();
const save = () => {
  const snapshot = JSON.stringify(progress, null, 2);
  saving = saving.then(() => fs.writeFile(path.join(root, "results.json"), snapshot));
  return saving;
};
const events = service.onDidChange((task) => {
  const workspace = owned.get(task.id);
  if (!workspace) return;
  for (const request of task.permissions)
    if (!answered.has(request.id)) {
      answered.add(request.id);
      const normalized = request.detail.replaceAll("\\\\", "/").replaceAll("\\", "/");
      const allow =
        normalized.includes(workspace) &&
        !/Remove-Item|rm -rf|Invoke-WebRequest|curl |Invoke-RestMethod/i.test(normalized);
      void service.respond({ taskId: task.id, permissionId: request.id, allow }).catch(() => {});
    }
});
async function settled(id: string) {
  const deadline = Date.now() + 180000;
  while (true) {
    const value = await service.read(id);
    if (value.status !== "running") return value;
    if (Date.now() > deadline) {
      await service.cancel(id);
      throw Error("超过180秒验收期限");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
try {
  const catalog = await service.catalog();
  const model = catalog
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel ?? ""} ${m.name}`));
  assert(model, "Claude Code目录没有可核实的DeepSeek模型，禁止替换其他模型");
  const lead = { harness: "step-code" as const, provider: "step-plan", model: "step-5-preview" };
  const sidekick = {
    harness: "claude-code" as const,
    provider: model.provider,
    model: model.id,
    thinking: "high",
  };
  await fs.writeFile(
    path.join(root, "pair.json"),
    JSON.stringify({ lead, sidekick, sidekickDisplay: model }, null, 2),
  );
  console.log(
    JSON.stringify({ root, lead, sidekick, realModel: model.realModel, name: model.name }),
  );
  const cases = [
    {
      name: "boolean",
      spec: "实现impl.mjs导出parseBoolean(raw)。仅接受string，trim后忽略大小写，true返回true、false返回false，其余抛TypeError。禁止用Boolean(raw)。",
      check:
        "import {parseBoolean} from './impl.mjs';assert.equal(parseBoolean(' TRUE '),true);assert.equal(parseBoolean(' false '),false);for(const x of ['', '0', 'yes', 0, null])assert.throws(()=>parseBoolean(x),TypeError);",
      after:
        "不调用任何执行或文件工具，仅让原副手凭记忆说明parseBoolean对字符串false返回什么，以及对0如何处理。",
    },
    {
      name: "retry",
      spec: 'impl.mjs已提供。必须先由副手运行check.mjs一次，记录预期失败；副手首次不得修改或自行重试。主手拿到证据后将input.json修改为{"count":4}，再让同一副手执行check.mjs一次。不要改impl.mjs或check.mjs。',
      check:
        "import {sum} from './impl.mjs';const input=JSON.parse(fs.readFileSync(new URL('input.json',import.meta.url),'utf8'));assert.equal(sum(input.count),10);",
      after: "不调用任何执行或文件工具，仅让原副手凭记忆说明失败原因、后来使用的count和最终结果。",
    },
  ];
  for (const c of cases) {
    const workspace = path.join(root, c.name).replaceAll("\\", "/");
    await fs.mkdir(workspace, { recursive: true });
    const code = `import fs from 'node:fs';import assert from 'node:assert/strict';fs.appendFileSync(new URL('starts.log',import.meta.url),${JSON.stringify("started\n")});${c.check}fs.writeFileSync(new URL('result.json',import.meta.url),JSON.stringify({case:${JSON.stringify(c.name)},passed:true}));console.log('PAIR_QA_PASS');`;
    await fs.writeFile(path.join(workspace, "check.mjs"), code);
    if (c.name === "retry") {
      await fs.writeFile(
        path.join(workspace, "impl.mjs"),
        "export function sum(n){if(!Number.isSafeInteger(n)||n<0)throw TypeError('count必须是非负整数');return n*(n+1)/2;}",
      );
      await fs.writeFile(path.join(workspace, "input.json"), '{"count":"bad"}');
    }
    const task = await service.create({
      workspacePath: workspace,
      dual: true,
      mode: "edit",
      lead,
      sidekick,
    });
    owned.set(task.id, workspace);
    const result = {
      name: c.name,
      id: task.id,
      workspace,
      testHash: createHash("sha256").update(code).digest("hex"),
      followup: c.after,
      status: "running",
    };
    progress.push(result);
    await save();
    await service.submit({
      taskId: task.id,
      requestId: randomUUID(),
      text: `所有面向用户输出中文。双角色小任务，限${workspace}，不加载技能、不联网、不操作GUI、不访问其他目录。实现和测试执行交给持久副手，主手负责审查。${c.spec} 运行测试时用各自原生PowerShell工具执行 node "${workspace}/check.mjs"，最多总共运行2次；普通失败允许修正后重试一次，但以此题的特殊要求为准。主手读取产物核对，不重复执行测试。最终简短报告。`,
    });
  }
  await Promise.all(
    progress.map(async (r) => {
      try {
        r.first = await settled(r.id);
        r.result = JSON.parse(await fs.readFile(path.join(r.workspace, "result.json"), "utf8"));
        r.starts = (await fs.readFile(path.join(r.workspace, "starts.log"), "utf8"))
          .trim()
          .split("\n").length;
        r.testUnchanged =
          createHash("sha256")
            .update(await fs.readFile(path.join(r.workspace, "check.mjs")))
            .digest("hex") === r.testHash;
        assert.equal(r.first.status, "completed", r.first.error);
        assert(r.testUnchanged);
        assert(r.result.passed);
        assert.equal(r.starts, r.name === "retry" ? 2 : 1);
        r.status = "passed";
      } catch (error) {
        r.status = "failed";
        r.error = error instanceof Error ? error.message : String(error);
      }
      await save();
      console.log(
        JSON.stringify({ name: r.name, status: r.status, starts: r.starts, error: r.error }),
      );
    }),
  );
  await Promise.all(
    progress
      .filter((r) => r.status === "passed")
      .map(async (r) => {
        const start = r.first.events.at(-1)?.seq ?? 0;
        await service.submit({ taskId: r.id, requestId: randomUUID(), text: r.followup });
        r.second = await settled(r.id);
        r.sameSidekick = r.second.sidekick.sessionId === r.first.sidekick.sessionId;
        r.followupTools = r.second.events.filter(
          (e) => e.seq > start && e.role === "sidekick" && e.kind === "tool",
        );
        assert.equal(r.second.status, "completed", r.second.error);
        assert(r.sameSidekick);
        assert.equal(r.followupTools.length, 0);
        await save();
        console.log(JSON.stringify({ name: r.name, sameSidekick: true, memoryOnly: true }));
      }),
  );
  if (progress.some((r) => r.status !== "passed")) process.exitCode = 1;
} finally {
  events.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await save();
  await disposeServiceResourcesAndWait(services);
}
