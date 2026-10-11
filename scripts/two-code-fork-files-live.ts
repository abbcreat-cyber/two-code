import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/fork-files-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(`${cwd}/source.json`, '{"name":"共同输入","amount":12}\n');
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, twoCodeForkPoints } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const owned = new Set<string>(),
  answered = new Set<string>();
const checks: string[] = [];
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
    }
});
async function turn(id: string, text: string, name: string) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const end = Date.now() + 150000;
  let t = await service.read(id);
  while (t.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    t = await service.read(id);
  }
  await fs.writeFile(`${root}/${name}.json`, JSON.stringify(t, null, 2));
  assert.equal(t.status, "completed", t.error || "超时");
  assert.equal(t.permissions.length, 0);
  return t;
}
let passed = false;
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  const source = await service.create({
    workspacePath: cwd,
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
      model: model.id,
      provider: model.provider,
      thinking: "high",
    },
  });
  owned.add(source.id);
  console.log(JSON.stringify({ root, source: source.id }));
  const limit = `只操作当前工作区${cwd}，不执行命令、不联网、不用技能，不修改source.json。`;
  const first = await turn(
    source.id,
    `${limit}让唯一副手只读source.json并报告两个字段，主手核对报告，暂不生成文件。`,
    "shared",
  );
  const atSeq = twoCodeForkPoints(first).at(-1)!;
  assert(atSeq);
  const request = { taskId: source.id, atSeq, requestId: randomUUID() };
  const branch = await service.fork(request);
  owned.add(branch.id);
  assert.notEqual(branch.sidekick.sessionId, first.sidekick.sessionId);
  assert.notEqual(branch.lead.sessionId, first.lead.sessionId);
  assert.equal((await service.fork(request)).id, branch.id);
  await fs.writeFile(`${root}/branch-created.json`, JSON.stringify(branch, null, 2));
  const jobs = await Promise.allSettled([
    turn(
      source.id,
      `${limit}让原副手只读source.json，将其两个字段和marker:"SOURCE_ONLY_73"写入source-result.json。不得读写branch-result.json。主手读自己的产物核对。`,
      "source-result",
    ),
    turn(
      branch.id,
      `${limit}让本分支副手只读source.json，将其两个字段和marker:"BRANCH_ONLY_42"写入branch-result.json。不得读写source-result.json。主手读自己的产物核对。`,
      "branch-result",
    ),
  ]);
  for (const result of jobs) if (result.status === "rejected") throw result.reason;
  const original = await service.read(source.id),
    forked = await service.read(branch.id);
  assert.equal(original.sidekick.sessionId, first.sidekick.sessionId);
  assert.equal(forked.sidekick.sessionId, branch.sidekick.sessionId);
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/source-result.json`, "utf8")), {
    name: "共同输入",
    amount: 12,
    marker: "SOURCE_ONLY_73",
  });
  assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/branch-result.json`, "utf8")), {
    name: "共同输入",
    amount: 12,
    marker: "BRANCH_ONLY_42",
  });
  assert.equal(
    await fs.readFile(`${cwd}/source.json`, "utf8"),
    '{"name":"共同输入","amount":12}\n',
  );
  assert(
    !original.events.some(
      (e) =>
        e.seq > atSeq &&
        ["handoff", "handoff_report"].includes(e.kind) &&
        e.text.includes("BRANCH_ONLY_42"),
    ),
  );
  assert(
    !forked.events.some(
      (e) =>
        e.seq > atSeq &&
        ["handoff", "handoff_report"].includes(e.kind) &&
        e.text.includes("SOURCE_ONLY_73"),
    ),
  );
  checks.push(
    "independent-native-sessions",
    "duplicate-fork-idempotent",
    "concurrent-file-handoffs-isolated",
    "shared-input-unchanged",
  );
  passed = true;
} finally {
  sub.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, passed, checks }, null, 2));
  console.log(JSON.stringify({ root, passed, checks }));
  await disposeServiceResourcesAndWait(services);
  if (!passed) process.exitCode = 1;
}
