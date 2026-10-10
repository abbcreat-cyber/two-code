import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { TwoCodeTask } from "../contract.js";
import type { CoordinatorDependencies } from "./ports.js";

for (const phase of ["lease", "read", "connections", "catalog", "save"] as const) {
  test(`cancel during admission ${phase} persists without starting or returning to running`, async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    let arm = false,
      calls = 0,
      leased = false;
    const stored = new Map<string, TwoCodeTask>();
    const pause = async (at: string) => {
      if (arm && at === phase) {
        entered();
        await held;
      }
    };
    const deps: CoordinatorDependencies = {
      sessionRoot: "D:/test-state",
      store: {
        load: async () => [],
        read: async (id) => {
          if (leased) await pause("read");
          return structuredClone(stored.get(id));
        },
        save: async (task) => {
          await pause("save");
          stored.set(task.id, structuredClone(task));
        },
      },
      lease: {
        isActive: async () => leased,
        acquire: async () => {
          await pause("lease");
          leased = true;
          return async () => {
            leased = false;
          };
        },
      },
      connections: async () => {
        await pause("connections");
        return {};
      },
      catalog: async () => {
        await pause("catalog");
        return [];
      },
      validateWorkspace: async (cwd) => cwd,
      createAdapter: () => ({
        run: async () => {
          calls++;
          return { text: "ok" };
        },
        cancel: async () => {},
        close: async () => {},
      }),
    };
    const service = new TwoCodeCoordinator(deps);
    const task = await service.create({
      workspacePath: "D:/sandbox",
      dual: false,
      lead: { harness: "pi" },
      sidekick: { harness: "pi" },
    });
    arm = true;
    const submit = service.submit({
      taskId: task.id,
      requestId: "first",
      text: "cancel this start",
    });
    const submitted = submit.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await reached;
    const snapshots: string[] = [];
    service.onDidChange((next) => {
      snapshots.push(next.status);
    });
    const stop = service.cancel(task.id);
    await new Promise<void>((r) => setImmediate(r));
    release();
    await stop;
    const receipt = await submitted;
    assert(!("error" in receipt), "intentional cancellation must not reject as a run error");
    assert.equal(calls, 0);
    assert.equal(stored.get(task.id)?.status, "cancelled");
    assert.equal(stored.get(task.id)?.error, undefined);
    assert.equal(snapshots.includes("running"), false, "cancelled start broadcast running");
    assert.equal(stored.get(task.id)?.events.filter((e) => e.role === "user").length, 1);
    arm = false;
    await service.submit({ taskId: task.id, requestId: "second", text: "now continue" });
    for (let i = 0; i < 30 && stored.get(task.id)?.status !== "completed"; i++)
      await new Promise<void>((r) => setImmediate(r));
    assert.equal(stored.get(task.id)?.status, "completed");
    assert.equal(calls, 1);
    await service.dispose();
  });
}

for (const failure of ["lease", "read", "save"] as const) {
  test(`cancellation does not hide ${failure} failures or overwrite an unread snapshot`, async () => {
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    let arm = false,
      leased = false,
      writes = 0,
      calls = 0;
    let saved: TwoCodeTask;
    const fail = async () => {
      entered();
      await held;
      throw new Error(`${failure} unavailable`);
    };
    const service = new TwoCodeCoordinator({
      sessionRoot: "D:/test-state",
      store: {
        load: async () => [],
        read: async () => {
          if (arm && leased && failure === "read") await fail();
          return structuredClone(saved);
        },
        save: async (task) => {
          if (arm && failure === "save") await fail();
          writes++;
          saved = structuredClone(task);
        },
      },
      lease: {
        isActive: async () => leased,
        acquire: async () => {
          if (failure === "lease") await fail();
          leased = true;
          return async () => {
            leased = false;
          };
        },
      },
      catalog: async () => [],
      validateWorkspace: async (cwd) => cwd,
      createAdapter: () => ({
        run: async () => {
          calls++;
          return { text: "bad" };
        },
        cancel: async () => {},
        close: async () => {},
      }),
    });
    const task = await service.create({
      workspacePath: "D:/sandbox",
      dual: false,
      lead: { harness: "pi" },
      sidekick: { harness: "pi" },
    });
    arm = true;
    const outcome = service
      .submit({ taskId: task.id, requestId: "blocked", text: "do not start" })
      .then(
        () => "success",
        (cause: Error) => cause.message,
      );
    await reached;
    const stop = service.cancel(task.id);
    await new Promise<void>((r) => setImmediate(r));
    release();
    const stopped = await stop;
    assert.match(await outcome, /unavailable/);
    assert.equal(calls, 0);
    assert.equal(writes, 1, "only the original create may save");
    assert.equal(saved!.status, "idle");
    if (failure === "save") {
      assert.equal(stopped.status, "error");
      assert.match(stopped.error!, /取消状态未能保存/);
    }
    assert.equal(leased, false);
    await service.dispose();
  });
}
