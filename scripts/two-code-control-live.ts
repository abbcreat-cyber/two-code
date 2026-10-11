import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/control-${process.env.TWO_CODE_CONTROL_LABEL || "baseline"}-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const owned = new Map<string, string>(),
  answered = new Set<string>(),
  results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id) || owned.get(t.id) === "cancel") return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
  }
});
async function until<T>(f: () => Promise<T | false>, ms = 120000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v !== false) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("验收超时");
}
const settle = (id: string) =>
  until(async () => {
    const t = await service.read(id);
    return t.status === "running" ? false : t;
  });
const save = async (name: string, id: string) =>
  fs.writeFile(`${root}/${name}.json`, JSON.stringify(await service.read(id), null, 2));
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, model: model.realModel }));
  for (const name of ["denied", "lead-denied", "cancel"].filter(
    (n) =>
      !process.env.TWO_CODE_CONTROL_CASES ||
      process.env.TWO_CODE_CONTROL_CASES.split(",").includes(n),
  )) {
    const cwd = `${root}/${name}`;
    await fs.mkdir(cwd, { recursive: true });
    const fixture =
      "import fs from 'node:fs';fs.writeFileSync(new URL('executed.txt',import.meta.url),'EXECUTED');console.log('OK');\n";
    await fs.writeFile(`${cwd}/check.mjs`, fixture);
    const t = await service.create({
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
    owned.set(t.id, name);
    const request = {
      taskId: t.id,
      requestId: randomUUID(),
      text: `${name === "lead-denied" ? "本轮主手直接操作，不派工" : "让副手操作"}：用原生PowerShell执行一次 node '${cwd}/check.mjs'。不读取或修改任何文件，不用其他工具，不联网。若权限被拒绝，就如实报告未执行，不重试、不换工具、不再派工。`,
    };
    try {
      await service.submit(request);
      if (name === "cancel") {
        const pending = await until(async () => {
          const x = await service.read(t.id);
          return x.permissions.some((p) => p.role === "sidekick") ? x : false;
        });
        const permission = pending.permissions.find((p) => p.role === "sidekick")!;
        const oldSession = pending.sidekick.sessionId;
        assert(oldSession);
        await service.submit(request);
        assert.equal(
          (await service.read(t.id)).events.filter((e) => e.role === "user" && e.kind === "message")
            .length,
          1,
          "重复请求被重复派发",
        );
        await save("cancel-pending", t.id);
        const stopped = await service.cancel(t.id);
        assert.equal(stopped.status, "cancelled");
        assert.equal(stopped.permissions.length, 0);
        assert.notEqual(stopped.lead.status, "running");
        assert.notEqual(stopped.sidekick.status, "running");
        await assert.rejects(
          service.respond({ taskId: t.id, permissionId: permission.id, allow: true }),
        );
        await save("cancel-stopped", t.id);
        const repeated = await service.submit(request);
        assert.equal(repeated.status, "cancelled");
        owned.set(t.id, "deny");
        await service.submit({
          taskId: t.id,
          requestId: randomUUID(),
          text: `继续，但取消之前的命令要求。让原副手仅用Write写当前工作区文件 ${cwd}/resumed.txt，内容RESUMED_ONLY，主手读这个确切路径核对。禁止任何命令，不重跑旧操作。`,
        });
        const resumed = await settle(t.id);
        assert.equal(resumed.status, "completed", resumed.error);
        assert.equal(resumed.sidekick.sessionId, oldSession);
        assert.equal((await fs.readFile(`${cwd}/resumed.txt`, "utf8")).trim(), "RESUMED_ONLY");
        assert.equal(resumed.permissions.length, 0);
        await assert.rejects(fs.access(`${cwd}/executed.txt`));
        results.push({
          name,
          passed: true,
          taskId: t.id,
          sameSidekick: true,
          duplicateSuppressed: true,
          staleApprovalRejected: true,
        });
      } else {
        const done = await settle(t.id);
        assert.equal(done.status, "completed", done.error);
        await assert.rejects(fs.access(`${cwd}/executed.txt`));
        assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture);
        assert.equal(done.permissions.length, 0);
        const role = name === "lead-denied" ? "lead" : "sidekick";
        const receipts = done.events
          .filter((e) => e.kind === "verification" && e.role === role)
          .map((e) => JSON.parse(e.text));
        assert.equal(receipts.length, 1);
        const notExecuted = done.events.some(
          (e) => e.role === role && e.kind === "tool" && e.notExecuted,
        );
        results.push({
          name,
          passed: receipts[0].status === "not-executed" && notExecuted,
          taskId: t.id,
          receipt: receipts[0],
          notExecuted,
          artifactAbsent: true,
          report: done.lead.lastReport,
        });
      }
    } catch (e) {
      results.push({ name, passed: false, taskId: t.id, error: String(e) });
    } finally {
      if ((await service.read(t.id)).status === "running") await service.cancel(t.id);
      await save(name, t.id);
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
