import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/step-claude-roundtrip-${Date.now()}`;
const workspace = `${root}/workspace`;
await fs.mkdir(workspace, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const createServices = () =>
  createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  });
let services = createServices();
let service = services.get(ITwoCodeService);
const owned = new Set<string>();
const permissions: Array<{ task: string; tool: string; allow: boolean }> = [];
const answered = new Set<string>();
let deny = true;
const subscribe = () =>
  service.onDidChange((task) => {
    if (!owned.has(task.id)) return;
    for (const p of task.permissions) {
      if (answered.has(p.id)) continue;
      answered.add(p.id);
      const args = JSON.parse(p.detail);
      const allow =
        !deny &&
        p.role === "sidekick" &&
        p.title === "Write" &&
        path.resolve(args.file_path ?? "") === path.resolve(workspace, "denied.txt");
      permissions.push({ task: task.id, tool: p.title, allow });
      void service.respond({ taskId: task.id, permissionId: p.id, allow }).catch(() => {});
    }
  });
let subscription = subscribe();
const snapshots: Record<string, TwoCodeTask> = {};
const outcomes: Array<{ name: string; passed: boolean; error?: string }> = [];
async function run(id: string, text: string, key: string) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const deadline = Date.now() + 180000;
  let state = await service.read(id);
  while (state.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    state = await service.read(id);
  }
  if (state.status === "running") state = await service.cancel(id);
  snapshots[key] = state;
  await fs.writeFile(`${root}/${key}.json`, JSON.stringify(state, null, 2));
  assert.equal(state.status, "completed", state.error ?? "本轮未完成");
  return state;
}
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    outcomes.push({ name, passed: true });
  } catch (error) {
    outcomes.push({ name, passed: false, error: String(error) });
  }
  console.log(JSON.stringify(outcomes.at(-1)));
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
  const tasks: Record<string, TwoCodeTask> = {};
  for (const name of ["denied", "alpha", "beta"]) {
    if (name !== "denied")
      await fs.writeFile(
        `${workspace}/${name}.json`,
        JSON.stringify(
          { identity: name, count: 1, tags: ["保留"], protected: { untouched: "中文 $ &" } },
          null,
          2,
        ),
      );
    tasks[name] = await service.create({
      workspacePath: workspace,
      dual: true,
      mode: name === "denied" ? "build" : "edit",
      lead,
      sidekick,
    });
    owned.add(tasks[name].id);
  }
  const prefix = `所有输出中文。工作目录${workspace}。禁止联网、技能、GUI、shell及一切命令工具。副手执行，主手仅read_file核对。仅操作指定文件。`;
  await Promise.all([
    check("denied-first", async () => {
      const state = await run(
        tasks.denied.id,
        `${prefix}副手只尝试一次Write创建denied.txt，内容FIRST，不带换行。如果权限拒绝，立即报告已拒绝；不重试，不换工具，主手如实报告未写入。`,
        "denied-first",
      );
      await assert.rejects(fs.access(`${workspace}/denied.txt`));
      assert.match(state.lead.lastReport ?? "", /拒绝|未.*写入/);
      assert.equal(permissions.filter((p) => p.task === tasks.denied.id).length, 1);
    }),
    ...["alpha", "beta"].map((name) =>
      check(`${name}-first`, async () => {
        await run(
          tasks[name].id,
          `${prefix}只用副手的Read和Edit工具修改${name}.json：count改为2，tags末尾追加本文件identity的值。其他字段和文件不动。主手用read_file核对。记住只属于本任务的暗号${name === "alpha" ? "青竹" : "红梅"}，不要写入文件。`,
          `${name}-first`,
        );
        assert.deepEqual(JSON.parse(await fs.readFile(`${workspace}/${name}.json`, "utf8")), {
          identity: name,
          count: 2,
          tags: ["保留", name],
          protected: { untouched: "中文 $ &" },
        });
      }),
    ),
  ]);
  subscription.dispose();
  await disposeServiceResourcesAndWait(services);
  services = createServices();
  service = services.get(ITwoCodeService);
  deny = false;
  subscription = subscribe();
  await Promise.all([
    check("denied-recovery", async () => {
      const state = await run(
        tasks.denied.id,
        `${prefix}这是新的明确授权：让原副手只用Write一次创建denied.txt，内容RECOVERED，不带换行。主手仅read_file核对后报告。`,
        "denied-second",
      );
      assert.equal(await fs.readFile(`${workspace}/denied.txt`, "utf8"), "RECOVERED");
      assert.equal(state.sidekick.sessionId, snapshots["denied-first"].sidekick.sessionId);
    }),
    ...["alpha", "beta"].map((name) =>
      check(`${name}-second`, async () => {
        const state = await run(
          tasks[name].id,
          `${prefix}让原副手仅Read、Edit修改本任务上轮的那个JSON文件：count改为3，移除tags中上轮追加的一项，保留原来的保留项。禁止读写另一个任务文件。其他字段不改。副手凭记忆报告本任务暗号，主手用read_file核对并报告暗号。`,
          `${name}-second`,
        );
        assert.deepEqual(JSON.parse(await fs.readFile(`${workspace}/${name}.json`, "utf8")), {
          identity: name,
          count: 3,
          tags: ["保留"],
          protected: { untouched: "中文 $ &" },
        });
        assert.equal(state.sidekick.sessionId, snapshots[`${name}-first`].sidekick.sessionId);
        assert.equal(state.lead.sessionId, snapshots[`${name}-first`].lead.sessionId);
        assert.match(state.lead.lastReport ?? "", name === "alpha" ? /青竹/ : /红梅/);
        assert(!state.lead.lastReport?.includes(name === "alpha" ? "红梅" : "青竹"));
      }),
    ),
  ]);
  assert.notEqual(
    snapshots["alpha-second"]?.sidekick.sessionId,
    snapshots["beta-second"]?.sidekick.sessionId,
  );
} finally {
  subscription.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ outcomes, permissions }, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (outcomes.some((o) => !o.passed)) process.exitCode = 1;
}
