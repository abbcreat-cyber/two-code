import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/fork-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, twoCodeForkPoints } = await import("../packages/services/src/index.js");
const options = {
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
};
let services = createLocalServices(options),
  service = services.get(ITwoCodeService);
const owned = new Set<string>();
let passed = false;
const settle = async (id: string) => {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") {
      assert.equal(t.status, "completed", t.error);
      return t;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("timeout");
};
const send = async (id: string, text: string) => {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  return settle(id);
};
const save = async (name: string, id: string) =>
  fs.writeFile(`${root}/${name}.json`, JSON.stringify(await service.read(id), null, 2));
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  const source = await service.create({
    workspacePath: cwd,
    dual: true,
    mode: "edit",
    title: "真实分叉验收",
    lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    sidekick: {
      harness: "claude-code",
      model: model.id,
      provider: model.provider,
      thinking: "high",
    },
  });
  owned.add(source.id);
  const a = "FORK_SHARED_7319",
    b = "FORK_SOURCE_8246",
    c = "FORK_BRANCH_9537";
  console.log(JSON.stringify({ root, source: source.id }));
  const first = await send(
    source.id,
    `你和唯一副手都记住暗号${a}。向副手派工仅记忆并返回此暗号，主手读取报告后简短回答。不要文件、命令、网络、技能或其他工具。`,
  );
  const atSeq = twoCodeForkPoints(first).at(-1)!;
  assert(atSeq);
  const second = await send(
    source.id,
    `你和原副手还要记住新增暗号${b}。让副手记住并返回此暗号，主手读报告。禁止其他工具。`,
  );
  await save("source-before-fork", source.id);
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const before = hash(await fs.readFile(second.lead.sessionId!, "utf8"));
  const request = { taskId: source.id, atSeq, requestId: randomUUID() };
  const [branch, repeated] = await Promise.all([service.fork(request), service.fork(request)]);
  owned.add(branch.id);
  assert.equal(branch.id, repeated.id);
  assert.notEqual(branch.lead.sessionId, second.lead.sessionId);
  assert.notEqual(branch.sidekick.sessionId, second.sidekick.sessionId);
  assert.equal(hash(await fs.readFile(second.lead.sessionId!, "utf8")), before);
  const native = await fs.readFile(branch.lead.sessionId!, "utf8");
  assert(native.includes(a));
  assert(!native.includes(b));
  assert(!branch.events.some((e) => e.text.includes(b)));
  await save("branch-created", branch.id);
  const forked = await send(
    branch.id,
    `先让原副手列出之前见过的FORK_开头暗号，随后你也列出之前见过的暗号。再让双方记住新暗号${c}。不调用历史查询、文件、命令、网络等工具；只用现有上下文和副手交接。`,
  );
  assert.match(forked.lead.lastReport!, new RegExp(a));
  assert(!forked.lead.lastReport!.includes(b));
  await save("branch-resumed", branch.id);
  const original = await send(
    source.id,
    "让原副手报告它见过的FORK_开头暗号，随后你也报告你见过的；不要其他工具。",
  );
  assert(original.lead.lastReport!.includes(a));
  assert(original.lead.lastReport!.includes(b));
  assert(!original.lead.lastReport!.includes(c));
  await save("source-resumed", source.id);
  await disposeServiceResourcesAndWait(services);
  services = createLocalServices(options);
  service = services.get(ITwoCodeService);
  assert.equal((await service.fork(request)).id, branch.id);
  assert.equal((await service.read(branch.id)).sidekick.sessionId, forked.sidekick.sessionId);
  passed = true;
  console.log(JSON.stringify({ passed, root, source: source.id, branch: branch.id, atSeq }));
} finally {
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/result.json`, JSON.stringify({ passed, root }, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (!passed) process.exitCode = 1;
}
