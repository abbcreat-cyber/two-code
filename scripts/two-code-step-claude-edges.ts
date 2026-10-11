import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/step-claude-edges-${Date.now()}`;
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
const owned = new Map<string, string>();
const manual = new Set<string>();
const answered = new Set<string>();
const outcomes: Record<string, unknown> = {};
const evidence = (name: string, value: unknown) =>
  fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value, null, 2));
const events = service.onDidChange((task) => {
  const workspace = owned.get(task.id);
  if (!workspace || manual.has(task.id)) return;
  for (const request of task.permissions) {
    if (answered.has(request.id)) continue;
    answered.add(request.id);
    const normalized = request.detail.replaceAll("\\\\", "/").replaceAll("\\", "/");
    const allow =
      normalized.includes(workspace) &&
      !/Remove-Item|rm -rf|Invoke-WebRequest|curl |Invoke-RestMethod/i.test(normalized);
    void service.respond({ taskId: task.id, permissionId: request.id, allow }).catch(() => {});
  }
});
async function waitFor(id: string, predicate: (task: TwoCodeTask) => boolean) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const task = await service.read(id);
    if (predicate(task)) return task;
    if (task.status !== "running") throw Error(`任务提前结束: ${task.status} ${task.error ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await service.cancel(id);
  throw Error("超过180秒验收期限");
}
const settled = (id: string) => waitFor(id, (task) => task.status !== "running");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
try {
  const catalog = await service.catalog();
  const model = catalog
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel ?? ""} ${m.name}`));
  assert(model, "Claude Code目录未核实DeepSeek模型");
  const lead = { harness: "step-code" as const, provider: "step-plan", model: "step-5-preview" };
  const sidekick = {
    harness: "claude-code" as const,
    provider: model.provider,
    model: model.id,
    thinking: "high",
  };
  await evidence("pair", { lead, sidekick, realModel: model.realModel, name: model.name });
  console.log(JSON.stringify({ root, lead, sidekick, realModel: model.realModel }));
  const prefix = (workspace: string) =>
    `所有输出中文。仅限工作区 ${workspace}，禁止联网、技能、GUI、其他目录。双角色小任务，主手派工并审查，副手执行。`;
  const jobs = [
    async () => {
      const workspace = `${root}/中文 空格 [样例] $`;
      await fs.mkdir(workspace, { recursive: true });
      const input = JSON.stringify([
        { name: "甲 $ & 空格", amount: 3 },
        { name: "乙[测试]", amount: 5 },
      ]);
      await fs.writeFile(`${workspace}/输入.json`, input);
      const check = `import fs from 'node:fs';import assert from 'node:assert/strict';fs.appendFileSync(new URL('starts.log',import.meta.url),'start\\n');const x=JSON.parse(fs.readFileSync(new URL('输出.json',import.meta.url),'utf8'));assert.deepEqual(x,{total:8,names:['甲 $ & 空格','乙[测试]']});fs.writeFileSync(new URL('result.json',import.meta.url),JSON.stringify({passed:true}));console.log('UNICODE_PASS');`;
      await fs.writeFile(`${workspace}/check.mjs`, check);
      const task = await service.create({
        workspacePath: workspace,
        dual: true,
        mode: "edit",
        lead,
        sidekick,
      });
      owned.set(task.id, workspace);
      const requestId = randomUUID();
      const text = `${prefix(workspace)}使用sidekick非阻塞派工(block=false)，然后read_sidekick读取报告。副手读取输入.json，将amount求和、name原样保序写入输出.json，格式{total:数字,names:数组}。副手用原生PowerShell执行 node '${workspace}/check.mjs' 一次；主手不执行命令，只读审查。不要改输入.json或check.mjs。`;
      await service.submit({ taskId: task.id, requestId, text });
      await service.submit({ taskId: task.id, requestId, text });
      const result = await settled(task.id);
      await evidence("unicode-task", result);
      assert.equal(result.status, "completed", result.error);
      assert.equal(await fs.readFile(`${workspace}/输入.json`, "utf8"), input);
      assert.equal(hash(await fs.readFile(`${workspace}/check.mjs`, "utf8")), hash(check));
      assert.deepEqual(JSON.parse(await fs.readFile(`${workspace}/输出.json`, "utf8")), {
        total: 8,
        names: ["甲 $ & 空格", "乙[测试]"],
      });
      assert.equal(await fs.readFile(`${workspace}/starts.log`, "utf8"), "start\n");
      assert(
        result.events.some(
          (e) => e.role === "lead" && e.kind === "tool" && e.text === "read_sidekick",
        ),
      );
      assert(
        result.events.some(
          (e) => e.role === "sidekick" && e.kind === "tool" && e.text === "PowerShell",
        ),
      );
      assert(!result.events.some((e) => e.kind === "tool" && /bash/i.test(e.text)));
      outcomes.unicode = { passed: true, task: task.id, sessionId: result.sidekick.sessionId };
    },
    async () => {
      const workspace = `${root}/cancel`;
      await fs.mkdir(workspace, { recursive: true });
      await fs.writeFile(
        `${workspace}/blocked.mjs`,
        "import fs from 'node:fs';fs.writeFileSync(new URL('must-not-exist.txt',import.meta.url),'unexpected');",
      );
      await fs.writeFile(
        `${workspace}/resume.mjs`,
        "import fs from 'node:fs';fs.appendFileSync(new URL('resume.log',import.meta.url),'resumed\\n');console.log('RESUME_OK=42');",
      );
      const task = await service.create({
        workspacePath: workspace,
        dual: true,
        mode: "edit",
        lead,
        sidekick,
      });
      owned.set(task.id, workspace);
      manual.add(task.id);
      await service.submit({
        taskId: task.id,
        requestId: randomUUID(),
        text: `${prefix(workspace)}让副手直接用原生PowerShell执行一次 node '${workspace}/blocked.mjs'。不要读写文件，不要重试，等待工具结果。`,
      });
      const pending = await waitFor(task.id, (t) =>
        t.permissions.some((p) => p.role === "sidekick" && p.title === "PowerShell"),
      );
      await evidence("cancel-pending", pending);
      const permission = pending.permissions.find((p) => p.role === "sidekick")!;
      const start = Date.now();
      const cancelled = await service.cancel(task.id);
      const cancelMs = Date.now() - start;
      await evidence("cancelled", cancelled);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.permissions.length, 0);
      assert.equal(cancelled.error, undefined);
      await assert.rejects(
        service.respond({ taskId: task.id, permissionId: permission.id, allow: true }),
        /失效/,
      );
      await assert.rejects(fs.access(`${workspace}/must-not-exist.txt`));
      manual.delete(task.id);
      await service.submit({
        taskId: task.id,
        requestId: randomUUID(),
        text: `${prefix(workspace)}前一项取消，不再执行blocked.mjs。继续使用原副手，用原生PowerShell只执行一次 node '${workspace}/resume.mjs'，主手读报告后告知结果即可。不调用读写工具，不重试。`,
      });
      const resumed = await settled(task.id);
      await evidence("resumed", resumed);
      assert.equal(resumed.status, "completed", resumed.error);
      assert.equal(resumed.sidekick.sessionId, pending.sidekick.sessionId);
      assert.equal(resumed.lead.sessionId, pending.lead.sessionId);
      assert.equal(await fs.readFile(`${workspace}/resume.log`, "utf8"), "resumed\n");
      await assert.rejects(fs.access(`${workspace}/must-not-exist.txt`));
      outcomes.cancel = {
        passed: true,
        task: task.id,
        sessionId: resumed.sidekick.sessionId,
        cancelMs,
      };
    },
  ];
  const results = await Promise.allSettled(jobs.map((job) => job()));
  results.forEach((r, index) => {
    if (r.status === "rejected") outcomes[`error${index}`] = String(r.reason);
  });
  const sessions = Object.values(outcomes)
    .filter(
      (v): v is { sessionId: string } => typeof v === "object" && v !== null && "sessionId" in v,
    )
    .map((v) => v.sessionId);
  assert.equal(new Set(sessions).size, sessions.length, "不同任务副手session发生串用");
  await evidence("results", outcomes);
  console.log(JSON.stringify(outcomes));
  if (results.some((r) => r.status === "rejected")) process.exitCode = 1;
} finally {
  events.dispose();
  for (const id of owned.keys()) {
    if ((await service.read(id)).status === "running") await service.cancel(id);
    await evidence(`final-${id}`, await service.read(id));
  }
  await disposeServiceResourcesAndWait(services);
}
