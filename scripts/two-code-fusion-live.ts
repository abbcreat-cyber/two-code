import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/fusion-live-${Date.now()}`;
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
const owned = new Map<string, string>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((task) => {
  const cwd = owned.get(task.id);
  if (!cwd) return;
  for (const p of task.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    const args = JSON.parse(p.detail);
    const allow =
      p.role === "sidekick" &&
      p.title === "PowerShell" &&
      [`node '${cwd}/wait.mjs'`, `node "${cwd}/wait.mjs"`].includes(String(args.command));
    void service.respond({ taskId: task.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function until<T>(predicate: () => Promise<T | false>, timeout = 180000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value !== false) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("验收超时");
}
const settle = (id: string) =>
  until(async () => {
    const t = await service.read(id);
    return t.status === "running" ? false : t;
  });
const save = (name: string, t: TwoCodeTask) =>
  fs.writeFile(`${root}/${name}.json`, JSON.stringify(t, null, 2));
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  const lead = { harness: "step-code" as const, provider: "step-plan", model: "step-5-preview" },
    sidekick = {
      harness: "claude-code" as const,
      provider: model.provider,
      model: model.id,
      thinking: "high",
    };
  console.log(JSON.stringify({ root, lead, sidekick, realModel: model.realModel }));
  await Promise.all(
    ["steer", "frozen"]
      .filter(
        (name) =>
          !process.env.TWO_CODE_FUSION_CASES ||
          process.env.TWO_CODE_FUSION_CASES.split(",").includes(name),
      )
      .map(async (name) => {
        const cwd = `${root}/${name}`;
        await fs.mkdir(cwd, { recursive: true });
        const task = await service.create({
          workspacePath: cwd,
          dual: true,
          mode: "edit",
          lead,
          sidekick,
        });
        owned.set(task.id, cwd);
        try {
          if (name === "steer") {
            await fs.writeFile(
              `${cwd}/wait.mjs`,
              "import fs from 'node:fs';fs.appendFileSync(new URL('started.txt',import.meta.url),'once\\n');setTimeout(()=>fs.writeFileSync(new URL('late.txt',import.meta.url),'obsolete'),45000);",
            );
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: `仅限${cwd}，不用联网、GUI或技能。让唯一副手用原生PowerShell精确执行命令 node '${cwd}/wait.mjs'，command必须逐字保持此字符串，不添加计时/退出码采集或任何前后缀。run_in_background为false；主手阻塞等待报告。不要读取/修改脚本，不重试，不使用其他工具，不要求报告耗时。`,
            });
            await until(async () => {
              if (
                await fs.access(`${cwd}/started.txt`).then(
                  () => true,
                  () => false,
                )
              )
                return true;
              if ((await service.read(task.id)).status !== "running")
                throw Error("未进入等待脚本，目标改向场景没有被触发");
              return false;
            }, 90000);
            const before = await service.read(task.id),
              started = Date.now();
            const update = {
              taskId: task.id,
              requestId: randomUUID(),
              text: `需求修改：立刻通知正在运行的同一副手停止原等待，不重跑命令；让它只用Write创建${cwd}/updated.txt，内容STEER_OK。主手read_file核对后报告。不要创建第二个副手。`,
            };
            await service.submit(update);
            const done = await settle(task.id);
            await save("steer", done);
            assert.equal(done.status, "completed", done.error);
            assert.equal((await fs.readFile(`${cwd}/updated.txt`, "utf8")).trim(), "STEER_OK");
            assert.equal(done.sidekick.sessionId, before.sidekick.sessionId);
            assert.equal(
              done.events.filter(
                (e) => e.role === "sidekick" && e.kind === "status" && e.text === "开始执行",
              ).length,
              1,
            );
            assert(done.events.some((e) => e.kind === "handoff_update"));
            assert(done.events.some((e) => e.continuation));
            const interrupted = done.events.find(
              (e) =>
                e.role === "sidekick" &&
                e.kind === "verification" &&
                JSON.parse(e.text).status === "interrupted",
            );
            assert(interrupted, "运行中改向应回报中断，而非执行失败或未执行");
            assert(
              done.events.some(
                (e) =>
                  e.kind === "tool_end" &&
                  e.toolCallId === interrupted.toolCallId &&
                  e.text === "interrupted",
              ),
            );
            const remaining = 46000 - (Date.now() - started);
            if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
            await assert.rejects(fs.access(`${cwd}/late.txt`));
            assert.equal(await fs.readFile(`${cwd}/started.txt`, "utf8"), "once\n");
            results.push({
              name,
              passed: true,
              sameSidekick: true,
              updateMs: Date.now() - started,
            });
          } else {
            await fs.writeFile(`${cwd}/frozen.json`, JSON.stringify({ feeTotal: 37.25, count: 5 }));
            await fs.writeFile(
              `${cwd}/source.json`,
              JSON.stringify({ feeTotal: 9999, count: 999 }),
            );
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: `已有核实后的结果在${cwd}/frozen.json，只需呈现，不需要重新计算。让副手只读这一个文件并写result.md，两行分别列feeTotal、count。禁止读取source.json；禁止shell、联网、技能、GUI，主手read_file核对产物，不重复计算。`,
            });
            const first = await settle(task.id);
            await save("frozen-first", first);
            assert.equal(first.status, "completed", first.error);
            assert(first.sidekick.availableTools?.length, "未取得原生副手工具目录");
            for (const blocked of [
              "Agent",
              "Task",
              "AskUserQuestion",
              "EnterPlanMode",
              "ExitPlanMode",
              "SendMessage",
            ])
              assert(!first.sidekick.availableTools.includes(blocked), `副手仍暴露${blocked}`);
            const output = await fs.readFile(`${cwd}/result.md`, "utf8");
            assert.match(output, /37\.25/);
            assert.match(output, /5/);
            assert(!output.includes("9999"));
            assert.equal(
              first.events.filter(
                (e) => e.role === "sidekick" && e.kind === "tool" && e.text === "Read",
              ).length,
              1,
            );
            const seq = first.events.at(-1)!.seq;
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: "让原副手调用read_handoff_history查阅最初交接和报告，准确报告原先哪一个文件禁止读取，以及已完成结果。禁止所有文件/执行工具，不重新计算。主手读取报告后直接回答。",
            });
            const next = await settle(task.id);
            await save("frozen-history", next);
            assert.equal(next.status, "completed", next.error);
            assert.equal(next.sidekick.sessionId, first.sidekick.sessionId);
            assert.match(next.lead.lastReport!, /source\.json/);
            assert.match(next.lead.lastReport!, /37\.25/);
            const tools = next.events
              .filter((e) => e.seq > seq && e.role === "sidekick" && e.kind === "tool")
              .map((e) => e.text);
            assert(tools.some((n) => n.endsWith("read_handoff_history")));
            assert(tools.every((n) => n.endsWith("read_handoff_history")));
            results.push({ name, passed: true, historyTools: tools });
          }
        } catch (error) {
          results.push({ name, passed: false, error: String(error) });
          await save(`${name}-failure`, await service.read(task.id));
        }
        console.log(JSON.stringify(results.at(-1)));
      }),
  );
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
