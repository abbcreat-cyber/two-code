import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createEnvironmentFixture, type EnvironmentCase } from "./two-code-environment-fixtures.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = process.env.TWO_CODE_ENVIRONMENT_ROOT?.replaceAll("\\", "/");
assert(root && /^D:\/Apps\/TwoCode\/qa\/environment-coding-\d+$/.test(root));
await fs.mkdir(root, { recursive: true });
await fs.writeFile(`${root}/owner.json`, JSON.stringify({ kind: "two-code-environment-qa", root }));
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
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      let allow = false;
      try {
        allow =
          p.role === "sidekick" &&
          p.title === "PowerShell" &&
          JSON.parse(p.detail).command === owned.get(t.id);
      } catch {
        /* 只允许本阶段明确的验证命令。 */
      }
      void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
    }
});
async function settle(id: string): Promise<TwoCodeTask> {
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  await service.cancel(id);
  throw Error("阶段超过300秒，已取消所属会话");
}
async function ledger(
  cwd: string,
): Promise<Array<{ phase: string; passed: boolean; error: string }>> {
  const raw = await fs
    .readFile(`${cwd}/.qa/ledger.jsonl`, "utf8")
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, sidekick: model }));
  const names: EnvironmentCase[] = ["visual", "browser", "android", "vm"];
  await Promise.all(
    names
      .filter(
        (n) =>
          !process.env.TWO_CODE_ENVIRONMENT_CASE ||
          process.env.TWO_CODE_ENVIRONMENT_CASE.split(",").includes(n),
      )
      .map(async (name) => {
        const cwd = `${root}/${name}`;
        const { check, stages } = await createEnvironmentFixture(name, cwd);
        const task = await service.create({
          workspacePath: cwd,
          title: `环境代码-${name}`,
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
        owned.set(task.id, "");
        const started = Date.now(),
          stageResults: Array<Record<string, unknown>> = [];
        let sessions: { lead?: string; sidekick?: string } | undefined;
        try {
          for (const stage of stages) {
            const before = await service.read(task.id),
              lastSeq = before.events.at(-1)?.seq ?? 0,
              count = (await ledger(cwd)).length,
              phaseStart = Date.now();
            const command = `node '${cwd}/check.mjs' ${stage.id}`;
            owned.set(task.id, command);
            const limits = `工作区${cwd}。只能修改src里的代码和README.md。check.mjs/reference.png/.qa为固定验收材料，不得修改或绕过。禁止联网、安装依赖、触碰用户其他环境和鼠标。主手先判断接口并交给唯一持久副手实现，由副手用原生PowerShell精确执行命令（不加前后缀）：\n${command}\n主手审查源码和副手原生回执，不重复运行已通过测试；失败由同副手修代码再测。浏览器由验收器启动独立无头Chrome，不操作用户浏览器。`;
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: `${stage.brief}\n${limits}`,
            });
            let done = await settle(task.id);
            assert.equal(done.status, "completed", done.error);
            assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check, "固定验收器被修改");
            let rows = await ledger(cwd),
              turns = 1;
            if (rows.length === count || !rows.at(-1)?.passed) {
              const error = rows.at(-1)?.error || "没有真实执行记录";
              console.log(JSON.stringify({ name, phase: stage.id, repair: error }));
              await service.submit({
                taskId: task.id,
                requestId: randomUUID(),
                text: `本阶段未通过：${error}。主手核对回执，交同一副手修复源码，按原命令重新验收。禁止改测试。\n${limits}`,
              });
              done = await settle(task.id);
              turns++;
              rows = await ledger(cwd);
            }
            assert.equal(done.status, "completed", done.error);
            assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
            assert(
              rows.length > count && rows.at(-1)?.passed && rows.at(-1)?.phase === stage.id,
              rows.at(-1)?.error || "缺少验证",
            );
            assert(
              done.events.some((e) => e.seq > lastSeq && e.kind === "handoff"),
              "没有真实交接",
            );
            assert(
              done.events.some((e) => e.seq > lastSeq && e.kind === "handoff_report"),
              "缺少副手报告",
            );
            if (sessions) {
              assert.equal(done.lead.sessionId, sessions.lead);
              assert.equal(done.sidekick.sessionId, sessions.sidekick);
            } else {
              assert(done.lead.sessionId && done.sidekick.sessionId);
              sessions = { lead: done.lead.sessionId, sidekick: done.sidekick.sessionId };
            }
            const receipts = done.events.filter(
              (e) =>
                e.seq > lastSeq &&
                e.kind === "verification" &&
                e.role === "sidekick" &&
                JSON.parse(e.text).status !== "not-executed",
            );
            assert.equal(receipts.length, rows.length - count, "原生回执与实际执行次数不一致");
            if (
              name === "visual" ||
              name === "android" ||
              (name === "browser" && stage.id === "robust")
            )
              for (const role of ["lead", "sidekick"])
                assert(
                  done.events.some(
                    (e) =>
                      e.seq > lastSeq &&
                      e.role === role &&
                      e.kind === "tool" &&
                      /view_image/.test(e.text),
                  ),
                  `${role}未真实看图`,
                );
            const result = {
              phase: stage.id,
              passed: true,
              elapsedMs: Date.now() - phaseStart,
              turns,
              testRuns: rows.length - count,
              handoffs: done.events.filter((e) => e.seq > lastSeq && e.kind === "handoff").length,
            };
            stageResults.push(result);
            console.log(JSON.stringify({ name, ...result }));
          }
          results.push({
            name,
            passed: true,
            taskId: task.id,
            elapsedMs: Date.now() - started,
            stages: stageResults,
            sessions,
          });
        } catch (e) {
          results.push({
            name,
            passed: false,
            taskId: task.id,
            error: String(e),
            stages: stageResults,
            sessions,
          });
        } finally {
          if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
          await fs.writeFile(
            `${root}/${name}-final.json`,
            JSON.stringify(await service.read(task.id), null, 2),
          );
          await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
          console.log(JSON.stringify({ name, result: results.find((r) => r.name === name) }));
        }
      }),
  );
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    `${root}/disposed.json`,
    JSON.stringify({ at: new Date().toISOString(), taskIds: [...owned.keys()] }),
  );
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
