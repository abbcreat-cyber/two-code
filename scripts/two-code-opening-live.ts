import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/opening-live-${Date.now()}`;
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
    const allow =
      p.title === "PowerShell" &&
      JSON.parse(p.detail).command?.replaceAll("\\", "/").includes(`${cwd}/check.mjs`);
    void service.respond({ taskId: task.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function settled(id: string): Promise<TwoCodeTask> {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  await service.cancel(id);
  throw Error("180秒验收超时");
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  const lead = { harness: "step-code" as const, provider: "step-plan", model: "step-5-preview" };
  const sidekick = {
    harness: "claude-code" as const,
    model: model.id,
    provider: model.provider,
    thinking: "high",
  };
  console.log(JSON.stringify({ root, lead, sidekick, realModel: model.realModel }));
  await Promise.all(
    ["summary", "repair", "json"].map(async (name) => {
      const cwd = `${root}/${name}`;
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(
        `${cwd}/data.json`,
        JSON.stringify([
          { name: "甲", amount: 2 },
          { name: "乙", amount: 3 },
          { name: "丙", amount: 5 },
        ]),
      );
      const check =
        "import assert from 'node:assert/strict';import fs from 'node:fs';import {median} from './impl.mjs';fs.appendFileSync(new URL('starts.log',import.meta.url),'start\\n');assert.equal(median([1,3,9]),3);assert.equal(median([2,4]),3);assert.equal(median([9,1,3,2]),2.5);console.log('MEDIAN_OK');";
      await fs.writeFile(
        `${cwd}/impl.mjs`,
        "export function median(xs){const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];}",
      );
      await fs.writeFile(`${cwd}/check.mjs`, check);
      const t = await service.create({
        workspacePath: cwd,
        dual: true,
        mode: "edit",
        lead,
        sidekick,
      });
      owned.set(t.id, cwd);
      const prefix = `仅限${cwd}。禁止联网、技能、GUI、其他目录。副手实施，主手用原生read_file核对，不重复执行副手命令。`;
      const prompt =
        name === "summary"
          ? `${prefix}整理data.json，让副手计算amount总和与条目数，写入summary.json，格式{"sum":数字,"count":数字}。双方仅用文件读写工具，不用shell。`
          : name === "repair"
            ? `${prefix}修复impl.mjs的median偶数项问题，空数组行为不在本题范围。副手用原生PowerShell执行一次 node '${cwd}/check.mjs'验证，只有实际失败才允许修正后再运行一次。禁止改check.mjs。`
            : `${prefix}派副手心算6乘7，双方不使用任何其他工具。只输出JSON对象{"value":42}，不要过程说明。`;
      const started = Date.now();
      try {
        await service.submit({ taskId: t.id, requestId: randomUUID(), text: prompt });
        const first = await settled(t.id);
        await fs.writeFile(`${root}/${name}.json`, JSON.stringify(first, null, 2));
        assert.equal(first.status, "completed", first.error);
        const opening = first.events.find(
          (e) => e.role === "lead" && e.kind === "message" && e.text.trim(),
        );
        const blocked = new Set(first.events.filter((e) => e.notExecuted).map((e) => e.toolCallId));
        const tool = first.events.find(
          (e) =>
            e.role === "lead" &&
            ["tool", "handoff"].includes(e.kind) &&
            !e.notExecuted &&
            (!e.toolCallId || !blocked.has(e.toolCallId)),
        );
        assert(opening);
        assert(tool);
        if (name === "json") {
          assert.deepEqual(JSON.parse(first.lead.lastReport!), { value: 42 });
          assert(opening.seq > tool.seq);
        } else {
          assert(opening.seq < tool.seq, "主手先调用工具后才说话");
          assert(
            first.events
              .filter((e) => e.role === "lead" && e.kind === "message" && e.seq < tool.seq)
              .map((e) => e.text)
              .join("")
              .trim().length > 5,
          );
        }
        if (name === "summary")
          assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/summary.json`, "utf8")), {
            sum: 10,
            count: 3,
          });
        if (name === "repair") {
          assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
          assert.equal(await fs.readFile(`${cwd}/starts.log`, "utf8"), "start\n");
        }
        if (name === "summary") {
          const seq = first.events.at(-1)!.seq;
          await service.submit({
            taskId: t.id,
            requestId: randomUUID(),
            text: "继续让原副手仅凭记忆报告上轮sum与count，不使用文件和执行工具。只回答两个数字。",
          });
          const next = await settled(t.id);
          await fs.writeFile(`${root}/summary-followup.json`, JSON.stringify(next, null, 2));
          assert.equal(next.status, "completed", next.error);
          assert.equal(next.sidekick.sessionId, first.sidekick.sessionId);
          assert(
            !next.events.some((e) => e.seq > seq && e.role === "sidekick" && e.kind === "tool"),
          );
          assert.match(next.lead.lastReport!, /10/);
          assert.match(next.lead.lastReport!, /3/);
        }
        results.push({
          name,
          passed: true,
          firstProseMs: Date.parse(opening.at) - started,
          opening: opening.text,
        });
      } catch (error) {
        results.push({ name, passed: false, error: String(error) });
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
