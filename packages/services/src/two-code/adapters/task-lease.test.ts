import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { TwoCodeCoordinator } from "../app/coordinator.js";
import { JsonTaskStore } from "./json-store.js";
import { TaskLease } from "./task-lease.js";
test("two host instances cannot execute the same task or overwrite its active status", async () => {
  const base = "D:/Apps/TwoCode/qa/unit-state";
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "lease-")),
    lease = new TaskLease(root);
  let release!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const make = () =>
    new TwoCodeCoordinator({
      sessionRoot: root,
      store: new JsonTaskStore(join(root, "tasks")),
      lease: new TaskLease(root),
      catalog: async () => [],
      validateWorkspace: async (path) => path,
      createAdapter: () => ({
        run: async () => {
          calls++;
          await held;
          return { text: "done" };
        },
        cancel: async () => {},
        close: async () => {},
      }),
    });
  const first = make();
  const task = await first.create({
    workspacePath: root,
    dual: false,
    lead: { harness: "pi" },
    sidekick: { harness: "claude-code" },
  });
  await first.submit({ taskId: task.id, requestId: "once", text: "work" });
  const second = make();
  try {
    assert.equal((await second.read(task.id)).status, "running");
    await assert.rejects(
      second.submit({ taskId: task.id, requestId: "other", text: "duplicate" }),
      /另一窗口|租约/,
    );
    await assert.rejects(second.cancel(task.id), /另一窗口/);
    release();
    for (let i = 0; i < 100 && (await lease.isActive(task.id)); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(await lease.isActive(task.id), false);
    assert.equal(
      (await second.submit({ taskId: task.id, requestId: "once", text: "work" })).status,
      "completed",
    );
    assert.equal(calls, 1);
  } finally {
    release();
    await first.dispose();
    await second.dispose();
  }
});
