import test from "node:test";
import assert from "node:assert/strict";
import { newTask, reconfigureTask } from "../domain/task.js";
import { TwoCodeCoordinator } from "./coordinator.js";

test("副手无保留休眠上下文，应用单模型组合不会跨底座替换原副手", () => {
  const source = newTask(
    "00000000-0000-4000-8000-000000000001",
    {
      workspacePath: "D:/qa",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code", model: "old" },
    },
    "now",
  );
  source.sidekick.sessionId = "persistent-sidekick";
  const off = reconfigureTask(source, {
    dual: false,
    lead: source.lead.selection,
    sidekick: { harness: "pi" },
  });
  assert.equal(off.dual, false);
  assert.deepEqual(off.sidekick, source.sidekick);
  assert.equal(source.dual, true);
  assert.throws(
    () =>
      reconfigureTask(off, {
        dual: true,
        lead: source.lead.selection,
        sidekick: { harness: "pi" },
      }),
    /脚手架/,
  );
  const on = reconfigureTask(off, {
    dual: true,
    lead: source.lead.selection,
    sidekick: { harness: "claude-code", model: "new" },
  });
  assert.equal(on.sidekick.sessionId, "persistent-sidekick");
  assert.equal(on.sidekick.selection.model, "new");
});
test("副手无不创建副手，也不把派工能力交给主手", async () => {
  let calls = 0;
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/qa",
    catalog: async () => [],
    validateWorkspace: async (p) => p,
    store: { load: async () => [], save: async () => {} },
    createAdapter: (h) => {
      assert.equal(h, "step-code");
      calls++;
      return {
        run: async (input) => {
          assert.equal(input.handoff, undefined);
          assert.equal(input.readSidekick, undefined);
          return { text: "SINGLE_OK", sessionId: "lead-only" };
        },
        cancel: async () => {},
        close: async () => {},
      };
    },
  });
  try {
    const task = await service.create({
      workspacePath: "D:/qa",
      dual: false,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    });
    await service.submit({ taskId: task.id, requestId: "single", text: "hello" });
    for (let i = 0; i < 50 && (await service.read(task.id)).status === "running"; i++)
      await new Promise<void>((r) => setImmediate(r));
    const done = await service.read(task.id);
    assert.equal(done.status, "completed");
    assert.equal(calls, 1);
    assert.equal(done.sidekick.sessionId, undefined);
    assert(!done.events.some((e) => e.role === "sidekick"));
  } finally {
    await service.dispose();
  }
});
