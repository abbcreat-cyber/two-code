import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { EngineRun } from "./ports.js";
import type { TwoCodeTask } from "../contract.js";

async function runTask(lead: (input: EngineRun) => Promise<void>, fails = false) {
  const stored = new Map<string, TwoCodeTask>();
  let finish!: (task: TwoCodeTask) => void;
  const done = new Promise<TwoCodeTask>((resolve) => {
    finish = resolve;
  });
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/test-state",
    store: {
      load: async () => [],
      save: async (task) => {
        stored.set(task.id, structuredClone(task));
      },
    },
    catalog: async () => [],
    validateWorkspace: async (cwd) => cwd,
    createAdapter: () => ({
      run: async (input) => {
        if (input.handoff) await lead(input);
        else if (fails) throw new Error("sidekick unavailable");
        return { text: input.handoff ? "main answer" : "17" };
      },
      cancel: async () => {},
      close: async () => {},
    }),
  });
  service.onDidChange((task) => {
    if (["completed", "error"].includes(task.status)) finish(task);
  });
  const task = await service.create({
    workspacePath: "D:/sandbox",
    dual: true,
    lead: { harness: "pi" },
    sidekick: { harness: "pi" },
  });
  await service.submit({ taskId: task.id, requestId: "one", text: "delegate" });
  const result = await done;
  await service.dispose();
  return { result, saved: stored.get(task.id)! };
}

test("finished nonblocking sidekick without report retrieval is not reviewed completion", async () => {
  const { result, saved } = await runTask(async (input) => {
    await input.handoff!("8+9", false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(result.status, "error");
  assert.match(result.error!, /read_sidekick/);
  assert.equal(saved.status, "error");
});

test("failed nonblocking sidekick cannot become a successful task", async () => {
  const { result } = await runTask(async (input) => {
    await input.handoff!("8+9", false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }, true);
  assert.equal(result.status, "error");
  assert.match(result.error!, /副手/);
});

test("retrieved report or blocking handoff allows completion", async () => {
  for (const block of [false, true]) {
    const { result } = await runTask(async (input) => {
      await input.handoff!("8+9", block);
      if (!block) assert.match(await input.readSidekick!(), /17/);
    });
    assert.equal(result.status, "completed", result.error);
  }
});

test("a new handoff invalidates the earlier report receipt", async () => {
  const { result } = await runTask(async (input) => {
    await input.handoff!("first", true);
    await input.handoff!("second", false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(result.status, "error");
  assert.match(result.error!, /read_sidekick/);
});
