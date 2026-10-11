import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/coordination-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const options = {
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
};
let services = createLocalServices(options),
  service = services.get(ITwoCodeService);
const owned = new Map<string, { name: string; cwd: string }>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((task) => {
  const entry = owned.get(task.id);
  if (!entry || entry.name === "rapid") return;
  for (const permission of task.permissions) {
    if (answered.has(permission.id)) continue;
    answered.add(permission.id);
    const command = JSON.parse(permission.detail).command;
    const allow =
      permission.role === "sidekick" &&
      permission.title === "PowerShell" &&
      [`node '${entry.cwd}/fail.mjs'`, `node "${entry.cwd}/fail.mjs"`].includes(command);
    void service.respond({ taskId: task.id, permissionId: permission.id, allow }).catch(() => {});
  }
});
async function until<T>(f: () => Promise<T | false>, ms = 150000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await f();
    if (value !== false) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("验收超时");
}
const settle = (id: string) =>
  until(async () => {
    const task = await service.read(id);
    return task.status === "running" ? false : task;
  });
const save = async (name: string, id: string) =>
  fs.writeFile(`${root}/${name}.json`, JSON.stringify(await service.read(id), null, 2));
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  console.log(JSON.stringify({ root, realModel: model.realModel }));
  await Promise.all(
    ["rapid", "failure-resume"].map(async (name) => {
      const cwd = `${root}/${name}`;
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(
        `${cwd}/fail.mjs`,
        "import fs from 'node:fs';fs.appendFileSync(new URL('executions.txt',import.meta.url),'once\\n');console.log('FAIL: controlled fixture\\nEXITCODE=7');process.exit(7);",
      );
      const task = await service.create({
        workspacePath: cwd,
        dual: true,
        mode: "edit",
        lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
        sidekick: {
          harness: "claude-code",
          provider: model.provider,
          model: model.id,
          thinking: "high",
        },
      });
      owned.set(task.id, { name, cwd });
      try {
        await service.submit({
          taskId: task.id,
          requestId: randomUUID(),
          text: `只在${cwd}操作，不用技能/网络/GUI。让唯一副手用原生PowerShell精确执行 node '${cwd}/fail.mjs'，command不得增加前后缀，run_in_background为false。只执行一次，不读/改脚本，不重试；如失败如实报告，主手读取副手报告。`,
        });
        if (name === "rapid") {
          const pending = await until(async () => {
            const t = await service.read(task.id);
            if (t.status !== "running") throw Error("未触发待审批改向场景");
            return t.permissions.some((p) => p.role === "sidekick") ? t : false;
          });
          const old = pending.permissions.find((p) => p.role === "sidekick")!;
          const first = {
            taskId: task.id,
            requestId: randomUUID(),
            text: `撤回旧命令，不得执行。通知同一副手改用Write创建${cwd}/first.txt，内容FIRST。主手read_file核对。`,
          };
          const second = {
            taskId: task.id,
            requestId: randomUUID(),
            text: `补充独立要求：同一副手还需用Write创建${cwd}/second.txt，内容SECOND；保留first.txt要求，禁止执行旧命令。主手read_file核对两个确切路径。`,
          };
          await Promise.all([
            service.submit(first),
            service.submit(second),
            service.submit(second),
          ]);
          const done = await settle(task.id);
          assert.equal(done.status, "completed", done.error);
          for (const input of [first, second])
            assert.equal(
              done.events.filter((e) => e.requestId === input.requestId && e.kind === "message")
                .length,
              1,
            );
          assert.equal(done.sidekick.sessionId, pending.sidekick.sessionId);
          assert(done.events.some((e) => e.kind === "handoff_update"));
          await assert.rejects(
            service.respond({ taskId: task.id, permissionId: old.id, allow: true }),
          );
          await assert.rejects(fs.access(`${cwd}/executions.txt`));
          assert.equal((await fs.readFile(`${cwd}/first.txt`, "utf8")).trim(), "FIRST");
          assert.equal((await fs.readFile(`${cwd}/second.txt`, "utf8")).trim(), "SECOND");
        } else {
          const failed = await settle(task.id);
          await save("failure-first", task.id);
          assert.equal(failed.status, "completed", failed.error);
          assert(
            failed.events.some(
              (e) => e.kind === "verification" && JSON.parse(e.text).reportedExitCode === 7,
            ),
          );
          await service.submit({
            taskId: task.id,
            requestId: randomUUID(),
            text: `已知旧命令退出7，本轮不重跑。不修改脚本。让同一副手仅用Write创建${cwd}/resumed.txt，内容RESUMED；主手read_file核对。`,
          });
          const resumed = await settle(task.id);
          assert.equal(resumed.status, "completed", resumed.error);
          assert.equal(resumed.sidekick.sessionId, failed.sidekick.sessionId);
          assert.equal((await fs.readFile(`${cwd}/resumed.txt`, "utf8")).trim(), "RESUMED");
          assert.equal(await fs.readFile(`${cwd}/executions.txt`, "utf8"), "once\n");
        }
        results.push({ name, passed: true, taskId: task.id });
      } catch (e) {
        results.push({ name, passed: false, taskId: task.id, error: String(e) });
      } finally {
        if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
        await save(name, task.id);
        console.log(JSON.stringify(results.find((r) => r.name === name)));
      }
    }),
  );
  const before = await Promise.all([...owned.keys()].map((id) => service.read(id)));
  sub.dispose();
  await disposeServiceResourcesAndWait(services);
  services = createLocalServices(options);
  service = services.get(ITwoCodeService);
  for (const previous of before) {
    const restored = await service.read(previous.id);
    assert.deepEqual(restored.events, previous.events);
    assert.deepEqual(restored.usage, previous.usage);
    assert.equal(restored.sidekick.sessionId, previous.sidekick.sessionId);
    assert.equal(restored.status, previous.status);
  }
  const target = before.find((t) => owned.get(t.id)?.name === "failure-resume")!;
  const cwd = owned.get(target.id)!.cwd;
  await service.submit({
    taskId: target.id,
    requestId: randomUUID(),
    text: `只让原副手用Write创建${cwd}/reopened.txt，内容REOPENED。主手read_file核对。禁止shell/网络/技能/其他文件操作。`,
  });
  const reopened = await settle(target.id);
  await save("reopened", target.id);
  assert.equal(reopened.status, "completed", reopened.error);
  assert.equal(reopened.lead.sessionId, target.lead.sessionId);
  assert.equal(reopened.sidekick.sessionId, target.sidekick.sessionId);
  assert.equal((await fs.readFile(`${cwd}/reopened.txt`, "utf8")).trim(), "REOPENED");
  results.push({ name: "host-reopen", passed: true, taskId: target.id });
  console.log(JSON.stringify(results.at(-1)));
} catch (e) {
  results.push({ name: "host-reopen", passed: false, error: String(e) });
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
