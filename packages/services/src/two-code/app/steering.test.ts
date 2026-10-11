import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { TwoCodeTask } from "../contract.js";
import type { EngineRun } from "./ports.js";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("用户插话唤醒阻塞读，更新同一副手；重复requestId不重复送达", async () => {
  const started = gate(),
    finish = gate();
  let leadUpdates = 0,
    childUpdates = 0,
    childStarts = 0;
  const saved = new Map<string, TwoCodeTask>();
  let childInput: EngineRun | undefined;
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/test-state",
    catalog: async () => [],
    validateWorkspace: async (p) => p,
    store: {
      load: async () => [],
      read: async (id) => saved.get(id),
      save: async (t) => {
        saved.set(t.id, structuredClone(t));
      },
    },
    createAdapter: (h) =>
      h === "step-code"
        ? {
            run: async (input) => {
              const initial = await input.handoff!("先做旧要求");
              assert.match(initial, /用户有新的补充/);
              assert.equal(childStarts, 1);
              const report = await input.handoff!("改为新要求", true);
              assert.match(report, /NEW_RESULT/);
              return { text: "已审查新要求", sessionId: "lead-native" };
            },
            update: async () => {
              leadUpdates++;
            },
            cancel: async () => {},
            close: async () => {},
          }
        : {
            run: async (input) => {
              childStarts++;
              childInput = input;
              await input.emit({ kind: "session", text: "child-native" });
              started.resolve();
              await finish.promise;
              return { text: "NEW_RESULT", sessionId: "child-native" };
            },
            update: async (message) => {
              childUpdates++;
              assert.match(message, /<lead_update>/);
              assert.match(message, /新要求/);
              finish.resolve();
            },
            cancel: async () => {
              finish.resolve();
            },
            close: async () => {},
          },
  });
  const task = await service.create({
    workspacePath: "D:/fixture",
    dual: true,
    lead: { harness: "step-code" },
    sidekick: { harness: "claude-code" },
  });
  await service.submit({ taskId: task.id, requestId: "first", text: "旧要求" });
  await started.promise;
  const update = { taskId: task.id, requestId: "update", text: "新要求" };
  await Promise.all([service.submit(update), service.submit(update)]);
  for (let i = 0; i < 50 && (await service.read(task.id)).status === "running"; i++)
    await new Promise<void>((r) => setImmediate(r));
  const done = await service.read(task.id);
  assert.equal(done.status, "completed", done.error);
  assert.equal(leadUpdates, 1);
  assert.equal(childUpdates, 1);
  assert.equal(childStarts, 1);
  assert.equal(done.sidekick.sessionId, "child-native");
  assert(done.events.some((e) => e.continuation && e.text === "新要求"));
  assert(done.events.some((e) => e.kind === "handoff_update"));
  assert(done.events.some((e) => e.kind === "handoff_report" && e.text === "NEW_RESULT"));
  assert.match(childInput!.prompt, /<lead_handoff>/);
  await service.dispose();
});

test("补充原生送达失败后停止旧计划，相同requestId在结算后仍拒绝", async () => {
  const started = gate();
  let updates = 0;
  const saved = new Map<string, TwoCodeTask>();
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/test-state",
    catalog: async () => [],
    validateWorkspace: async (p) => p,
    store: {
      load: async () => [],
      read: async (id) => saved.get(id),
      save: async (task) => {
        saved.set(task.id, structuredClone(task));
      },
    },
    createAdapter: () => ({
      run: async (input) => {
        started.resolve();
        await new Promise<void>((resolve) =>
          input.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        input.signal.throwIfAborted();
        return { text: "不应继续旧计划" };
      },
      update: async () => {
        updates++;
        throw new Error("native update transport failed");
      },
      cancel: async () => {},
      close: async () => {},
    }),
  });
  const task = await service.create({
    workspacePath: "D:/fixture",
    dual: false,
    lead: { harness: "step-code" },
    sidekick: { harness: "claude-code" },
  });
  await service.submit({ taskId: task.id, requestId: "first", text: "旧要求" });
  await started.promise;
  const update = { taskId: task.id, requestId: "failed-update", text: "停止旧要求" };
  await assert.rejects(service.submit(update), /未确认送达/);
  for (let i = 0; i < 50 && (await service.read(task.id)).status === "running"; i++)
    await new Promise<void>((r) => setImmediate(r));
  const done = await service.read(task.id);
  assert.equal(done.status, "error");
  assert(done.events.some((e) => e.requestId === update.requestId && e.deliveryFailed));
  await assert.rejects(service.submit(update), /未确认送达/);
  assert.equal(updates, 1);
  await service.dispose();
});
