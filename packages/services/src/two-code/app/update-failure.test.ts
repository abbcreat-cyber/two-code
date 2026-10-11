import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { EngineRun } from "./ports.js";
import type { TwoCodeTask } from "../contract.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function evidence(name: string, task: TwoCodeTask) {
  const root = process.env.TWO_CODE_FAILURE_EVIDENCE_DIR;
  if (!root) return;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.json`), JSON.stringify(task, null, 2));
}

const turn = () => new Promise<void>((r) => setImmediate(r));
for (const persistent of [false, true]) {
  test(`补充保存${persistent ? "持续" : "单次"}失败必须停止旧计划，重复请求仍失败`, async () => {
    let input: EngineRun | undefined,
      fail = false,
      updates = 0;
    const stored = new Map<string, TwoCodeTask>();
    const service = new TwoCodeCoordinator({
      sessionRoot: "D:/fixture",
      catalog: async () => [],
      validateWorkspace: async (p) => p,
      store: {
        load: async () => [],
        read: async (id) => stored.get(id),
        save: async (task) => {
          if (fail) {
            if (!persistent) fail = false;
            throw Error("disk unavailable");
          }
          stored.set(task.id, structuredClone(task));
        },
      },
      createAdapter: () => ({
        run: async (value) => {
          input = value;
          await new Promise<void>((r) =>
            value.signal.addEventListener("abort", () => r(), { once: true }),
          );
          value.signal.throwIfAborted();
          return { text: "old plan" };
        },
        update: async () => {
          updates++;
        },
        cancel: async () => {},
        close: async () => {},
      }),
    });
    try {
      const task = await service.create({
        workspacePath: "D:/fixture",
        dual: false,
        lead: { harness: "step-code" },
        sidekick: { harness: "claude-code" },
      });
      await service.submit({ taskId: task.id, requestId: "first", text: "old" });
      fail = true;
      const update = { taskId: task.id, requestId: "update", text: "new" };
      await assert.rejects(
        service.submit(update),
        persistent ? /错误状态保存失败/ : /disk unavailable/,
      );
      assert.equal(input!.signal.aborted, true, "保存失败不能继续旧计划");
      // 磁盘持续不可用时，后续读取也可能直接报存储故障，但绝不能返回成功。
      await assert.rejects(service.submit(update), persistent ? /disk unavailable/ : /未确认送达/);
      assert.equal(updates, 0);
      fail = false;
      for (let n = 0; n < 50 && (await service.read(task.id)).status === "running"; n++)
        await turn();
      assert.equal((await service.read(task.id)).status, "error");
      if (!persistent) await evidence("user-update", await service.read(task.id));
    } finally {
      fail = false;
      await service.dispose();
    }
  });
}

test("副手update拒绝后，即使主手吞掉工具异常也不能用旧报告完成", async () => {
  const finish = Promise.withResolvers<void>();
  let sidekick: EngineRun | undefined;
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/fixture",
    catalog: async () => [],
    validateWorkspace: async (p) => p,
    store: { load: async () => [], save: async () => {} },
    createAdapter: (h) =>
      h === "step-code"
        ? {
            run: async (input) => {
              await input.handoff!("old", false);
              await input.handoff!("new", true).catch(() => {});
              await input.readSidekick!().catch(() => {});
              return { text: "旧结果冒充新结果" };
            },
            cancel: async () => {},
            close: async () => {},
          }
        : {
            run: async (input) => {
              sidekick = input;
              input.signal.addEventListener("abort", () => finish.resolve(), { once: true });
              await finish.promise;
              return { text: "OLD_RESULT" };
            },
            update: async () => {
              finish.resolve();
              throw Error("update transport unavailable");
            },
            cancel: async () => {
              finish.resolve();
            },
            close: async () => {},
          },
  });
  try {
    const task = await service.create({
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    });
    await service.submit({ taskId: task.id, requestId: "first", text: "do task" });
    for (let n = 0; n < 50 && (await service.read(task.id)).status === "running"; n++) await turn();
    const done = await service.read(task.id);
    assert.equal(done.status, "error");
    assert.match(done.error!, /副手.*未确认送达/);
    assert(sidekick!.signal.aborted);
    assert(
      done.events.some((e) => e.kind === "error" && /update transport unavailable/.test(e.text)),
    );
    await evidence("sidekick-update", done);
  } finally {
    await service.dispose();
  }
});
