import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";
const resumeRoot = process.env.TWO_CODE_COMMON_RESUME;
const root = resumeRoot || `D:/Apps/TwoCode/qa/common-followup-${Date.now()}`;
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
const subscription = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    // 本组只有工作区内文件操作；任何命令或额外授权都拒绝。
    void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
  }
});
async function turn(taskId: string, text: string, label: string) {
  const start = Date.now();
  await service.submit({ taskId, requestId: randomUUID(), text });
  while (Date.now() - start < 150000) {
    const t = await service.read(taskId);
    if (t.status !== "running") {
      await fs.writeFile(`${root}/${label}.json`, JSON.stringify(t, null, 2));
      assert.equal(t.status, "completed", t.error);
      assert.equal(t.permissions.length, 0);
      return t;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await service.cancel(taskId);
  throw Error(`${label}超过150秒`);
}
const prefs = (t: TwoCodeTask, dual: boolean) => ({
  dual,
  mode: t.mode,
  lead: t.lead.selection,
  sidekick: t.sidekick.selection,
});
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, model: model.name }));
  await Promise.all(
    ["toggle", "missing"]
      .filter((name) => !resumeRoot || name === "missing")
      .map(async (name) => {
        const workspacePath = `${root}/${name} 中文 空格`;
        await fs.mkdir(workspacePath, { recursive: true });
        const t = resumeRoot
          ? (await service.list(workspacePath))[0]!
          : await service.create({
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
                provider: model.provider,
                model: model.id,
                thinking: "high",
              },
            });
        owned.add(t.id);
        const start = Date.now();
        const restriction = `只在当前工作区${workspacePath}操作，仅用文件工具，不执行命令、不联网。`;
        try {
          if (name === "toggle") {
            await fs.writeFile(
              `${workspacePath}/config.json`,
              '{"theme":"light","port":8080,"keep":"原样"}\n',
            );
            const first = await turn(
              t.id,
              `${restriction}让唯一副手读取config.json，仅把theme改为dark，其余不变。主手读产物核对。副手记住本次交接标记松柏42。`,
              "toggle-first",
            );
            assert.equal(
              JSON.parse(await fs.readFile(`${workspacePath}/config.json`, "utf8")).theme,
              "dark",
            );
            assert(first.events.some((e) => e.kind === "handoff_report"));
            assert(first.sidekick.sessionId);
            await service.configure({ taskId: t.id, preferences: prefs(first, false) });
            const second = await turn(
              t.id,
              `${restriction}本轮由主手直接读取config.json，只把port改为9090，保留其余字段。`,
              "toggle-solo",
            );
            assert(
              !second.events.some((e) => e.seq > first.events.at(-1)!.seq && e.role === "sidekick"),
            );
            assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
            assert.deepEqual(
              JSON.parse(await fs.readFile(`${workspacePath}/config.json`, "utf8")),
              {
                theme: "dark",
                port: 9090,
                keep: "原样",
              },
            );
            await service.configure({ taskId: t.id, preferences: prefs(second, true) });
            const third = await turn(
              t.id,
              `${restriction}请让同一副手重新读取config.json，只新增checked:true。副手同时凭自己的历史回报最初的交接标记；主手读产物核对。不重做前两轮修改。`,
              "toggle-resumed",
            );
            assert.equal(third.sidekick.sessionId, first.sidekick.sessionId);
            assert.equal(third.lead.sessionId, first.lead.sessionId);
            assert.match(third.sidekick.lastReport!, /松柏\s*42/);
            assert.deepEqual(
              JSON.parse(await fs.readFile(`${workspacePath}/config.json`, "utf8")),
              {
                theme: "dark",
                port: 9090,
                keep: "原样",
                checked: true,
              },
            );
          } else {
            const first = resumeRoot
              ? await service.read(t.id)
              : await turn(
                  t.id,
                  `${restriction}让副手读取当前目录尚不存在的source.json。若缺失，停止并如实报告，不找替代文件，不创建任何文件。主手读报告后简短告知。`,
                  "missing-first",
                );
            assert(first.sidekick.sessionId);
            assert(
              first.events.some(
                (e) => e.role === "sidekick" && e.kind === "tool_end" && e.text === "error",
              ),
            );
            await assert.rejects(fs.access(`${workspacePath}/source.json`));
            await fs.writeFile(`${workspacePath}/source.json`, '{"name":"小林","count":3}\n');
            const second = await turn(
              t.id,
              `${restriction}source.json现在已补齐。让同一副手读取后原样复制到result.json，主手读产物核对。`,
              "missing-recovered",
            );
            assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
            assert.deepEqual(
              JSON.parse(await fs.readFile(`${workspacePath}/result.json`, "utf8")),
              {
                name: "小林",
                count: 3,
              },
            );
          }
          results.push({ name, passed: true, taskId: t.id, elapsedMs: Date.now() - start });
        } catch (error) {
          results.push({ name, passed: false, taskId: t.id, error: String(error) });
        } finally {
          if ((await service.read(t.id)).status === "running") await service.cancel(t.id);
          await fs.writeFile(
            `${root}/${name}-final.json`,
            JSON.stringify(await service.read(t.id), null, 2),
          );
          console.log(JSON.stringify(results.find((r) => r.name === name)));
        }
      }),
  );
} finally {
  subscription.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(
    `${root}/${resumeRoot ? "recovery-results" : "results"}.json`,
    JSON.stringify(results, null, 2),
  );
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
