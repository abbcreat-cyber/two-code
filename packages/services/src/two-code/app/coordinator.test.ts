import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { TwoCodeTask } from "../contract.js";
import type { CoordinatorDependencies, EngineRun } from "./ports.js";

function fixture(
  run: (input: EngineRun) => Promise<{ text: string; sessionId?: string }>,
  initial: TwoCodeTask[] = [],
) {
  const stored = new Map(initial.map((task) => [task.id, structuredClone(task)]));
  let failSave = false;
  const dependencies: CoordinatorDependencies = {
    sessionRoot: "D:/test-state",
    store: {
      load: async () => [...stored.values()].map((task) => structuredClone(task)),
      save: async (task) => {
        if (failSave) throw new Error("disk unavailable");
        stored.set(task.id, structuredClone(task));
      },
    },
    catalog: async () => [],
    validateWorkspace: async (path) => path,
    createAdapter: () => ({ run, cancel: async () => {}, close: async () => {} }),
  };
  const service = new TwoCodeCoordinator(dependencies);
  return {
    service,
    stored,
    failSave: (value: boolean) => {
      failSave = value;
    },
  };
}
const create = (service: TwoCodeCoordinator) =>
  service.create({
    workspacePath: "D:/sandbox",
    dual: true,
    lead: { harness: "claude-code" },
    sidekick: { harness: "pi", model: "small" },
  });
async function settled(service: TwoCodeCoordinator, id: string) {
  for (let i = 0; i < 100; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const task = await service.read(id);
    if (task.status !== "running") return task;
  }
  throw new Error("task did not settle");
}
test("lead delegates to one persistent sidekick and reviews its result", async () => {
  const children: Array<string | undefined> = [];
  const { service } = fixture(async (input) => {
    if (input.handoff)
      return { text: "审查：" + (await input.handoff(input.prompt)), sessionId: "lead-native" };
    children.push(input.sessionId);
    return { text: "文件已生成", sessionId: "child-native" };
  });
  const task = await create(service);
  await service.submit({ taskId: task.id, requestId: "one", text: "实现" });
  assert.equal((await settled(service, task.id)).status, "completed");
  await service.submit({ taskId: task.id, requestId: "two", text: "改一处" });
  const result = await settled(service, task.id);
  assert.equal(result.sidekick.sessionId, "child-native");
  assert.deepEqual(children, [undefined, "child-native"]);
  assert.match(result.lead.lastReport ?? "", /审查/);
  assert(result.events.every((event, i) => event.seq === i + 1));
});
test("duplicate request IDs never run twice", async () => {
  let calls = 0;
  const { service } = fixture(async () => {
    calls++;
    return { text: "ok" };
  });
  const task = await create(service);
  const input = { taskId: task.id, requestId: "same", text: "once" };
  await Promise.all([service.submit(input), service.submit(input)]);
  await settled(service, task.id);
  await service.submit(input);
  assert.equal(calls, 1);
});
test("cancellation rejects late success and preserves the same task", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { service } = fixture(async () => {
    await held;
    return { text: "too late", sessionId: "native" };
  });
  const task = await create(service);
  await service.submit({ taskId: task.id, requestId: "one", text: "run" });
  const stopping = service.cancel(task.id);
  release();
  const result = await stopping;
  assert.equal(result.status, "cancelled");
  assert.notEqual(result.lead.lastReport, "too late");
});
test("failed admission persistence starts no model and permits explicit retry", async () => {
  let calls = 0;
  const { service, failSave } = fixture(async () => {
    calls++;
    return { text: "ok" };
  });
  const task = await create(service);
  const input = { taskId: task.id, requestId: "one", text: "run" };
  failSave(true);
  await assert.rejects(service.submit(input), /disk unavailable/);
  assert.equal(calls, 0);
  failSave(false);
  await service.submit(input);
  await settled(service, task.id);
  assert.equal(calls, 1);
});
test("cancel resolves pending permission as denied", async () => {
  let allowed: boolean | undefined;
  const { service } = fixture(async (input) => {
    allowed = await input.permission("写文件", "impl.ts");
    return { text: "done" };
  });
  const task = await create(service);
  await service.submit({ taskId: task.id, requestId: "one", text: "run" });
  const pending = await service.read(task.id);
  assert.equal(pending.permissions.length, 1);
  const permission = pending.permissions[0];
  assert(permission);
  await service.cancel(task.id);
  assert.equal(allowed, false);
  await assert.rejects(
    service.respond({ taskId: task.id, permissionId: permission.id, allow: true }),
    /失效/,
  );
});
test("restart marks unfinished work for explicit recovery without rerunning", async () => {
  const first = fixture(async () => ({ text: "ok" }));
  const task = await create(first.service);
  task.status = "running";
  task.lead.sessionId = "native";
  let calls = 0;
  const restored = fixture(async () => {
    calls++;
    return { text: "bad" };
  }, [task]);
  const result = await restored.service.read(task.id);
  assert.equal(result.status, "error");
  assert.equal(result.lead.sessionId, "native");
  assert.equal(calls, 0);
});
