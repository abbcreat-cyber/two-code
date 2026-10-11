import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/common-review-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const owned = new Set<string>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
    }
});
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root }));
  await Promise.all(
    ["revision", "async"].map(async (name) => {
      const workspacePath = `${root}/${name}`;
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.writeFile(
        `${workspacePath}/source.json`,
        '{"title":"日报","count":3,"keep":"不变"}\n',
      );
      await fs.writeFile(
        `${workspacePath}/rules.md`,
        "核对规则：count必须为3，keep必须为“不变”。\n",
      );
      const task = await service.create({
        workspacePath,
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
      owned.add(task.id);
      const base = `只操作当前工作区${workspacePath}，只用文件工具，不执行命令、不联网。禁止修改source.json和rules.md。`;
      const text =
        name === "revision"
          ? `${base}做一次两步协作：先让副手读取source.json，创建draft.json，在原字段外增加stage:"draft"，报告必须包含REVISION_ONE；等报告返回，主手读draft.json核对。然后第二次派给同一副手，只把draft.json中的stage改为"final"，其他字段保留，报告必须包含REVISION_TWO。主手必须读取第二次报告并读最终文件核对，最后简短报告。严格按先后两次交接，不把两个步骤一次派完。`
          : `${base}做一次有独立主手工作的后台派工：使用sidekick且block:false，让副手读取source.json，原样复制字段并增加ready:true写入result.json。主手在派工返回后独立读取rules.md用于验收，再调用read_sidekick等待最终报告，不轮询。取得副手报告后主手读取result.json，对照规则核对。主手不写文件，副手不读rules.md。`;
      const start = Date.now();
      try {
        await service.submit({ taskId: task.id, requestId: randomUUID(), text });
        let done = await service.read(task.id);
        while (done.status === "running" && Date.now() - start < 150000) {
          await new Promise((r) => setTimeout(r, 200));
          done = await service.read(task.id);
        }
        assert.equal(done.status, "completed", done.error || "任务未在150秒内完成");
        assert.equal(done.permissions.length, 0);
        assert.equal(
          await fs.readFile(`${workspacePath}/source.json`, "utf8"),
          '{"title":"日报","count":3,"keep":"不变"}\n',
        );
        assert.equal(
          await fs.readFile(`${workspacePath}/rules.md`, "utf8"),
          "核对规则：count必须为3，keep必须为“不变”。\n",
        );
        const handoffs = done.events.filter((e) => e.kind === "handoff"),
          reports = done.events.filter((e) => e.kind === "handoff_report");
        if (name === "revision") {
          assert.equal(handoffs.length, 2);
          assert.equal(reports.length, 2);
          assert(reports[0]!.seq < handoffs[1]!.seq);
          assert.match(reports[0]!.text, /REVISION_ONE/);
          assert.match(reports[1]!.text, /REVISION_TWO/);
          assert.deepEqual(JSON.parse(await fs.readFile(`${workspacePath}/draft.json`, "utf8")), {
            title: "日报",
            count: 3,
            keep: "不变",
            stage: "final",
          });
        } else {
          assert.equal(handoffs.length, 1);
          assert.equal(reports.length, 1);
          const call = done.events.find(
            (e) => e.role === "lead" && e.kind === "tool" && e.text === "sidekick",
          )!;
          const ack = done.events.find(
            (e) => e.kind === "tool_end" && e.toolCallId === call.toolCallId,
          )!;
          assert(ack.seq < reports[0]!.seq, "未按非阻塞派工");
          assert(
            done.events.some(
              (e) => e.role === "lead" && e.kind === "tool" && e.text === "read_sidekick",
            ),
          );
          assert.deepEqual(JSON.parse(await fs.readFile(`${workspacePath}/result.json`, "utf8")), {
            title: "日报",
            count: 3,
            keep: "不变",
            ready: true,
          });
        }
        results.push({
          name,
          passed: true,
          taskId: task.id,
          elapsedMs: Date.now() - start,
          handoffs: handoffs.length,
          reports: reports.length,
        });
      } catch (error) {
        results.push({ name, passed: false, taskId: task.id, error: String(error) });
      } finally {
        if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
        await fs.writeFile(
          `${root}/${name}.json`,
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
