import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { configure } from "./two-code-glm-code-fixture.mjs";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/glm-coordination-${Date.now()}`;
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-glm-coordination-qa", root }),
);
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
const owned = new Map<string, { name: string; command?: string; hold?: boolean }>();
const answered = new Set<string>(),
  results: Record<string, unknown>[] = [],
  permissions: unknown[] = [];
const sub = service.onDidChange((t) => {
  const policy = owned.get(t.id);
  if (!policy || policy.hold) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    let allow = false;
    try {
      allow =
        p.role === "sidekick" &&
        p.title === "PowerShell" &&
        JSON.parse(p.detail).command === policy.command;
    } catch {}
    permissions.push({ taskId: t.id, tool: p.title, role: p.role, allow });
    void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function until<T>(get: () => Promise<T | false>, ms = 180000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await get();
    if (value !== false) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("180秒验收截止");
}
async function turn(task: TwoCodeTask, name: string, text: string) {
  const started = Date.now();
  await service.submit({ taskId: task.id, requestId: randomUUID(), text });
  const done = await until(async () => {
    const t = await service.read(task.id);
    return t.status === "running" ? false : t;
  });
  await fs.writeFile(`${root}/${name}.json`, JSON.stringify(done, null, 2));
  assert.equal(done.status, "completed", done.error ?? "任务未完成");
  assert.equal(done.permissions.length, 0);
  console.log(
    JSON.stringify({ stage: name, status: done.status, elapsedMs: Date.now() - started }),
  );
  return done;
}
const sessions = (t: TwoCodeTask) => [t.lead.sessionId, t.sidekick.sessionId];
async function nativeEvidence(t: TwoCodeTask) {
  if (!t.sidekick.sessionId) return { models: [], failures: [] };
  const file = path.join(
    homedir(),
    ".claude/projects",
    t.workspacePath.replace(/[^a-zA-Z0-9]/g, "-"),
    `${t.sidekick.sessionId}.jsonl`,
  );
  const rows = (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const calls = new Map<string, unknown>(),
    failures: unknown[] = [];
  for (const row of rows)
    for (const block of Array.isArray(row.message?.content) ? row.message.content : []) {
      if (block.type === "tool_use") calls.set(block.id, { name: block.name, input: block.input });
      if (block.type === "tool_result" && block.is_error)
        failures.push({ call: calls.get(block.tool_use_id), content: block.content });
    }
  return {
    models: [
      ...new Set(
        rows
          .filter((r) => r.type === "assistant")
          .map((r) => r.message?.model)
          .filter(Boolean),
      ),
    ],
    failures,
  };
}
async function runCase(
  name: string,
  body: (t: TwoCodeTask, cwd: string) => Promise<Record<string, unknown>>,
  flash = false,
) {
  const cwd = `${root}/${name}`;
  await fs.mkdir(cwd, { recursive: true });
  const task = await service.create({
    workspacePath: cwd,
    title: `GLM边界-${name}`,
    dual: true,
    mode: "edit",
    lead: {
      harness: "step-code",
      provider: "step-plan",
      model: "step-5-preview",
      thinking: "medium",
    },
    sidekick: {
      harness: "claude-code",
      provider: "bigmodel-coding-plan",
      model: flash ? "glm-5.3-flash" : "glm-5.3",
      thinking: "max",
    },
  });
  owned.set(task.id, { name });
  const started = Date.now();
  try {
    const detail = await body(task, cwd);
    const native = await nativeEvidence(await service.read(task.id));
    assert(native.models.includes(flash ? "glm-5.3-flash" : "glm-5.3"));
    results.push({
      name,
      passed: true,
      taskId: task.id,
      elapsedMs: Date.now() - started,
      ...detail,
      native,
    });
  } catch (error) {
    results.push({ name, passed: false, taskId: task.id, error: String(error) });
  } finally {
    if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
    await fs.writeFile(
      `${root}/${name}-final.json`,
      JSON.stringify(await service.read(task.id), null, 2),
    );
    await fs.writeFile(`${root}/results.json`, JSON.stringify({ results, permissions }, null, 2));
    console.log(JSON.stringify({ ...results.at(-1), native: undefined }));
  }
}
async function asyncRevision(task: TwoCodeTask, cwd: string) {
  const source = '{"title":"交接样例","count":3,"keep":"不可更改"}\n';
  await fs.writeFile(`${cwd}/source.json`, source);
  await fs.writeFile(`${cwd}/rules.md`, "验收：count等于3，keep等于不可更改。\n");
  const limit = `仅操作${cwd}，只用原生文件工具，不运行命令、不联网。不修改source.json和rules.md。主手不写文件，副手不读rules.md。`;
  const first = await turn(
    task,
    "async-first",
    `${limit}主手用sidekick block:false后台派工：副手读取source.json，保留全部字段并增加stage:"draft"写入result.json，报告ASYNCHRONOUS_DRAFT。主手在派工返回后独立读取rules.md，再用read_sidekick等待最终报告，不轮询。主手收到报告后读取result.json核对。`,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/result.json`, "utf8")), {
    title: "交接样例",
    count: 3,
    keep: "不可更改",
    stage: "draft",
  });
  const call = first.events.find(
    (e) => e.role === "lead" && e.kind === "tool" && e.text === "sidekick",
  )!;
  const ack = first.events.find((e) => e.kind === "tool_end" && e.toolCallId === call.toolCallId)!;
  const report = first.events.find((e) => e.kind === "handoff_report")!;
  assert(ack && report && ack.seq < report.seq, "异步派工未在副手报告前返回");
  assert(
    first.events.some(
      (e) =>
        e.role === "lead" &&
        e.kind === "tool" &&
        /read.*file|^read$/i.test(e.text) &&
        e.seq > ack.seq &&
        e.seq < report.seq,
    ),
    "缺少派工期间主手独立读取",
  );
  assert(
    first.events.some((e) => e.role === "lead" && e.kind === "tool" && e.text === "read_sidekick"),
  );
  const second = await turn(
    task,
    "async-revision",
    `${limit}读取上一轮副手报告后向同一个副手返工：仅把result.json的stage改成"final"，其他字段保持不变。副手报告REVISION_DONE。主手读文件核对，再给简短结论。`,
  );
  assert.deepEqual(sessions(second), sessions(first));
  assert.equal(second.events.filter((e) => e.kind === "handoff_report").length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/result.json`, "utf8")), {
    title: "交接样例",
    count: 3,
    keep: "不可更改",
    stage: "final",
  });
  assert.equal(await fs.readFile(`${cwd}/source.json`, "utf8"), source);
  return { sameSessions: true, nonblocking: true, reports: 2 };
}
async function failureRecovery(task: TwoCodeTask, cwd: string) {
  await fs.mkdir(`${cwd}/.qa`);
  const check = `import fs from 'node:fs';let ok=false;try{const r=JSON.parse(fs.readFileSync(new URL('answer.json',import.meta.url),'utf8'));ok=r.total===42&&r.status==='fixed';}catch{}fs.appendFileSync(new URL('.qa/ledger.jsonl',import.meta.url),JSON.stringify({passed:ok})+'\\n');console.log(ok?'PASS 1 check passed':'FAIL answer missing or invalid');process.exit(ok?0:17);`;
  await fs.writeFile(`${cwd}/check.mjs`, check);
  const command = `node '${cwd}/check.mjs'`;
  owned.set(task.id, { name: "failure-recovery", command });
  const done = await turn(
    task,
    "failure-recovery",
    `工作区${cwd}。主手只派工与读文件验收，自己不执行命令。交唯一副手按顺序：1.原生PowerShell精确执行下方命令一次，当前answer.json不存在，预期退出码17；如实记录失败，不改验收器。2.用Write创建answer.json，内容{"total":42,"status":"fixed"}。3.原生PowerShell再精确执行同一命令一次，预期成功。最后报告两次真实退出结果。主手必须核对两次原生验证回执与answer.json，不额外重跑。禁止修改check.mjs和.qa目录，禁止联网，所有写操作限本工作区；不经Bash包装。\n${command}`,
  );
  assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
  const ledger = (await fs.readFile(`${cwd}/.qa/ledger.jsonl`, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((s) => JSON.parse(s));
  assert.deepEqual(ledger, [{ passed: false }, { passed: true }]);
  const allReceipts = done.events
    .filter((e) => e.role === "sidekick" && e.kind === "verification")
    .map((e) => JSON.parse(e.text));
  const receipts = allReceipts.filter((r) => r.status !== "not-executed");
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].status, "failed");
  assert.equal(receipts[0].reportedExitCode, 17);
  assert.equal(receipts[1].status, "completed");
  return { ledger, receipts, notExecuted: allReceipts.filter((r) => r.status === "not-executed") };
}
async function cancelResume(task: TwoCodeTask, cwd: string) {
  await fs.writeFile(
    `${cwd}/check.mjs`,
    "import fs from 'node:fs';fs.writeFileSync(new URL('executed.txt',import.meta.url),'UNEXPECTED');\n",
  );
  owned.set(task.id, { name: "cancel-resume", hold: true });
  const request = {
    taskId: task.id,
    requestId: randomUUID(),
    text: `交唯一副手用原生PowerShell精确执行node '${cwd}/check.mjs'一次，不读取、不修改文件，不联网，不用其他工具。主手等报告。`,
  };
  await service.submit(request);
  const pending = await until(async () => {
    const t = await service.read(task.id);
    if (t.status !== "running") throw Error(t.error ?? "未到审批就已结束");
    return t.permissions.some((p) => p.role === "sidekick") ? t : false;
  });
  const permission = pending.permissions.find((p) => p.role === "sidekick")!;
  assert.equal(permission.title, "PowerShell");
  await service.submit(request);
  assert.equal(
    (await service.read(task.id)).events.filter((e) => e.role === "user" && e.kind === "message")
      .length,
    1,
  );
  const stopped = await service.cancel(task.id);
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.permissions.length, 0);
  await assert.rejects(
    service.respond({ taskId: task.id, permissionId: permission.id, allow: true }),
  );
  assert.equal((await service.submit(request)).status, "cancelled");
  owned.set(task.id, { name: "cancel-resume" });
  const resumed = await turn(
    task,
    "cancel-resume",
    `取消之前的命令要求。现在让原副手仅用Write在${cwd}/resumed.txt写入RESUMED_ONLY，主手读取这个文件核对。禁止命令、联网及旧操作。`,
  );
  assert.deepEqual(sessions(resumed), sessions(pending));
  assert.equal((await fs.readFile(`${cwd}/resumed.txt`, "utf8")).trim(), "RESUMED_ONLY");
  await assert.rejects(fs.access(`${cwd}/executed.txt`));
  return {
    sameSessions: true,
    duplicateSuppressed: true,
    staleApprovalRejected: true,
    oldCommandNotExecuted: true,
  };
}
async function flashRecovery(task: TwoCodeTask, cwd: string) {
  await fs.writeFile(`${cwd}/actual.json`, '{"value":29,"marker":"FLASH_FILE_731"}');
  const done = await turn(
    task,
    "flash-file",
    `仅在${cwd}操作，禁止命令和联网。主手让唯一副手先用Read读取明确不存在的missing.json一次，这是工具错误恢复验收，不能创建这个文件也不能重试；随后读取actual.json，把原字段保留并增加recovered:true写入result.json。主手读产物核对并简短报告。`,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/result.json`, "utf8")), {
    value: 29,
    marker: "FLASH_FILE_731",
    recovered: true,
  });
  const native = await nativeEvidence(done);
  assert(JSON.stringify(native.failures).includes("missing.json"), "必须实际触发缺失文件工具错误");
  await assert.rejects(fs.access(`${cwd}/missing.json`));
  return { recovered: true };
}
console.log(JSON.stringify({ root, pair: "Step Plan medium / Claude GLM-5.3 max" }));
try {
  await Promise.all([
    runCase("async-revision", asyncRevision),
    runCase("failure-recovery", failureRecovery),
    runCase("cancel-resume", cancelResume),
  ]);
  await runCase("flash-file", flashRecovery, true);
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ at: new Date().toISOString(), taskIds: [...owned.keys()] }),
  );
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ results, permissions }, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
