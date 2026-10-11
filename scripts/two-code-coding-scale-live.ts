import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCodingFixture, type CodingSize } from "./two-code-coding-fixtures.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";
const root = `D:/Apps/TwoCode/qa/coding-scale-${Date.now()}`;
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
const owned = new Map<string, { command: string }>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((t) => {
  const target = owned.get(t.id);
  if (!target) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      let allow = false;
      try {
        allow =
          p.role === "sidekick" &&
          p.title === "PowerShell" &&
          JSON.parse(p.detail).command === target.command;
      } catch {
        /* 未指定的命令不授权。 */
      }
      void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
    }
});
async function readLedger(
  cwd: string,
): Promise<Array<{ phase: string; passed: boolean; error: string; hash: string }>> {
  const raw = await fs
    .readFile(`${cwd}/.qa/ledger.jsonl`, "utf8")
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
async function settle(id: string, timeout: number): Promise<TwoCodeTask> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  await service.cancel(id);
  throw Error("本阶段超时，已取消所属任务");
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, pair: "Step Plan / Claude DeepSeek" }));
  await Promise.all(
    (["small", "medium", "long"] as CodingSize[]).map(async (size) => {
      const cwd = `${root}/${size}`;
      const { check, stages } = await createCodingFixture(size, cwd);
      const task = await service.create({
        workspacePath: cwd,
        title: `代码协作-${size}`,
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
      owned.set(task.id, { command: "" });
      const started = Date.now(),
        stageResults: Array<Record<string, unknown>> = [];
      let sessions: { lead?: string; sidekick?: string } | undefined;
      try {
        for (const stage of stages) {
          const before = await service.read(task.id),
            lastSeq = before.events.at(-1)?.seq ?? 0;
          const ledgerBefore = (await readLedger(cwd)).length;
          const command = `node '${cwd}/check.mjs' ${stage.id}`;
          owned.set(task.id, { command });
          const limits = `工作区为${cwd}。代码只写src内的.mjs文件和README.md。check.mjs是固定验收器，.qa由验收器持有，不得修改、删除或绕过它们。无需npm依赖，禁止联网、安装依赖或修改工作区外文件。主手先确定接口和范围，再用唯一持久副手完成实现和验证，自己读关键源码及副手原生回执审查。副手验证仅用原生PowerShell精确执行下面命令，command不得增加前后缀：\n${command}\n测试失败则副手修复源码后再验证，输入和代码都没变化的通过结果不重跑；禁止改测试来变绿。主手不重复执行验证。`;
          const phaseStart = Date.now();
          await service.submit({
            taskId: task.id,
            requestId: randomUUID(),
            text: `${stage.brief}\n\n${limits}`,
          });
          let done = await settle(task.id, size === "small" ? 180000 : 300000);
          await fs.writeFile(
            `${root}/${size}-${stage.id}-attempt1.json`,
            JSON.stringify(done, null, 2),
          );
          assert.equal(done.status, "completed", done.error);
          assert.equal(
            await fs.readFile(`${cwd}/check.mjs`, "utf8"),
            check,
            "模型修改了固定测试，停止该档验收",
          );
          let ledger = await readLedger(cwd),
            attempts = 1;
          if (
            ledger.length === ledgerBefore ||
            !ledger.at(-1)!.passed ||
            ledger.at(-1)!.phase !== stage.id
          ) {
            const issue =
              ledger.length === ledgerBefore
                ? "未找到本阶段真实验证记录"
                : ledger.at(-1)!.error.slice(0, 1800);
            console.log(
              JSON.stringify({ size, stage: stage.id, codeCheck: "needs-repair", issue }),
            );
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: `验收尚未通过：${issue}\n请主手核对上次工具回执，向同一副手交回具体修复要求；只修实现，禁止改check.mjs，按原命令完成本阶段验证后再交付。\n${limits}`,
            });
            done = await settle(task.id, 300000);
            attempts++;
            await fs.writeFile(
              `${root}/${size}-${stage.id}-attempt2.json`,
              JSON.stringify(done, null, 2),
            );
            assert.equal(done.status, "completed", done.error);
            assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
            ledger = await readLedger(cwd);
          }
          assert(
            ledger.length > ledgerBefore &&
              ledger.at(-1)!.phase === stage.id &&
              ledger.at(-1)!.passed,
            `代码验证未通过：${ledger.at(-1)?.error ?? "没有测试记录"}`,
          );
          assert(
            done.events.some((e) => e.seq > lastSeq && e.kind === "handoff"),
            "未通过副手交接完成本阶段",
          );
          assert(
            done.events.some((e) => e.seq > lastSeq && e.kind === "handoff_report"),
            "缺少副手报告",
          );
          if (sessions) {
            assert.equal(done.lead.sessionId, sessions.lead, "主手阶段续接丢失原生会话");
            assert.equal(done.sidekick.sessionId, sessions.sidekick, "副手阶段续接丢失原生会话");
          } else {
            assert(done.lead.sessionId && done.sidekick.sessionId);
            sessions = { lead: done.lead.sessionId, sidekick: done.sidekick.sessionId };
          }
          const receipts = done.events.filter(
            (e) =>
              e.seq > lastSeq &&
              e.role === "sidekick" &&
              e.kind === "verification" &&
              JSON.parse(e.text).status !== "not-executed",
          );
          assert.equal(
            receipts.length,
            ledger.length - ledgerBefore,
            "原生验证回执与测试实际运行次数不符",
          );
          const info = {
            size,
            stage: stage.id,
            passed: true,
            elapsedMs: Date.now() - phaseStart,
            modelTurns: attempts,
            testRuns: ledger.length - ledgerBefore,
            handoffs: done.events.filter((e) => e.seq > lastSeq && e.kind === "handoff").length,
          };
          stageResults.push(info);
          await fs.writeFile(`${root}/${size}-stages.json`, JSON.stringify(stageResults, null, 2));
          console.log(JSON.stringify(info));
        }
        results.push({
          size,
          passed: true,
          taskId: task.id,
          elapsedMs: Date.now() - started,
          stages: stageResults,
        });
      } catch (error) {
        results.push({
          size,
          passed: false,
          taskId: task.id,
          error: String(error),
          stages: stageResults,
        });
      } finally {
        if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
        await fs.writeFile(
          `${root}/${size}-final.json`,
          JSON.stringify(await service.read(task.id), null, 2),
        );
        console.log(JSON.stringify({ size, result: results.find((r) => r.size === size) }));
      }
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
