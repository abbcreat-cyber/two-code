import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/common-boundaries-${Date.now()}`;
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
const owned = new Set<string>(),
  answered = new Set<string>(),
  results: Array<Record<string, unknown>> = [];
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
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root }));
  await Promise.all(
    ["plan", "files"].map(async (name) => {
      const cwd = `${root}/${name}`;
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(`${cwd}/one.json`, '{"code":"FIRST","value":11}\n');
      await fs.writeFile(`${cwd}/two.json`, '{"code":"SECOND","value":22}\n');
      const task = await service.create({
        workspacePath: cwd,
        dual: true,
        mode: name === "plan" ? "plan" : "edit",
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
      owned.add(task.id);
      const start = Date.now(),
        limit = `只操作当前工作区${cwd}，仅用文件工具和交接，不执行命令、不联网，不修改one.json和two.json。`;
      try {
        if (name === "plan") {
          const first = await turn(
            task.id,
            `${limit}让唯一副手读取one.json，再尝试用Write创建requested.json，内容固定为{"ok":true}。如果写入被当前权限模式拒绝，就报告未执行，不换工具、不重试、不请求退出计划模式；主手读取报告如实说明。`,
            "plan-denied",
          );
          await assert.rejects(fs.access(`${cwd}/requested.json`));
          assert(first.sidekick.sessionId);
          assert(first.events.some((e) => e.role === "sidekick" && e.notExecuted));
          await service.configure({
            taskId: task.id,
            preferences: {
              dual: true,
              mode: "edit",
              lead: first.lead.selection,
              sidekick: first.sidekick.selection,
            },
          });
          const second = await turn(
            task.id,
            `${limit}已切为编辑模式。让同一副手现在用Write创建requested.json，内容固定为{"ok":true}，主手读文件核对。`,
            "plan-to-edit",
          );
          assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
          assert.equal(second.lead.sessionId, first.lead.sessionId);
          assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/requested.json`, "utf8")), {
            ok: true,
          });
        } else {
          const first = await turn(
            task.id,
            `${limit}让副手读取one.json，将原字段和值写入one-result.json，再增加checked:true；主手读产物核对。此轮不读two.json。`,
            "files-first",
          );
          const before = await fs.readFile(`${cwd}/one-result.json`, "utf8");
          assert.deepEqual(JSON.parse(before), { code: "FIRST", value: 11, checked: true });
          const second = await turn(
            task.id,
            `${limit}现在让同一副手只读取two.json，原字段和值写入two-result.json，再增加checked:true；主手读产物核对。不要读取或修改one-result.json，也不要沿用上一轮数据。`,
            "files-second",
          );
          assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
          assert.equal(await fs.readFile(`${cwd}/one-result.json`, "utf8"), before);
          assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/two-result.json`, "utf8")), {
            code: "SECOND",
            value: 22,
            checked: true,
          });
          assert.equal(second.events.filter((e) => e.kind === "handoff_report").length, 2);
        }
        assert.equal(await fs.readFile(`${cwd}/one.json`, "utf8"), '{"code":"FIRST","value":11}\n');
        assert.equal(
          await fs.readFile(`${cwd}/two.json`, "utf8"),
          '{"code":"SECOND","value":22}\n',
        );
        results.push({ name, passed: true, taskId: task.id, elapsedMs: Date.now() - start });
      } catch (error) {
        results.push({ name, passed: false, taskId: task.id, error: String(error) });
      } finally {
        if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
        await fs.writeFile(
          `${root}/${name}-final.json`,
          JSON.stringify(await service.read(task.id), null, 2),
        );
        console.log(JSON.stringify(results.find((r) => r.name === name)));
      }
    }),
  );
} finally {
  sub.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
