import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import { newTask } from "../domain/task.js";
import type { TwoCodeTask } from "../contract.js";

function fixture() {
  let saved = newTask(
    "00000000-0000-4000-8000-000000000001",
    {
      workspacePath: "D:/sandbox",
      dual: false,
      lead: { harness: "pi" },
      sidekick: { harness: "pi" },
    },
    "2026-10-11T00:00:03.000Z",
  );
  saved.status = "running";
  saved.lead.status = "running";
  saved.lead.sessionId = "native-preserved";
  saved.events = [
    { seq: 1, at: "2026-10-11T00:00:00.000Z", role: "user", kind: "message", text: "first" },
  ];
  let owned = false,
    foreign = false,
    writes = 0,
    calls = 0;
  let probe = () => foreign;
  let read = async () => structuredClone(saved);
  let run = async () => ({ text: "ok" });
  const service = new TwoCodeCoordinator({
    sessionRoot: "D:/test-state",
    catalog: async () => [],
    validateWorkspace: async (p) => p,
    store: {
      load: async () => [structuredClone(saved)],
      read: () => read(),
      save: async (task) => {
        writes++;
        saved = structuredClone(task);
      },
    },
    lease: {
      isActive: async () => owned || probe(),
      acquire: async () => {
        if (foreign || owned) throw new Error("lease busy");
        owned = true;
        return async () => {
          owned = false;
        };
      },
    },
    createAdapter: () => ({
      run: async () => {
        calls++;
        return run();
      },
      cancel: async () => {},
      close: async () => {},
    }),
  });
  return {
    service,
    id: saved.id,
    get saved() {
      return saved;
    },
    get calls() {
      return calls;
    },
    get writes() {
      return writes;
    },
    probe: (next: () => boolean) => {
      probe = next;
    },
    owner: (value: boolean) => {
      foreign = value;
    },
    save: (next: TwoCodeTask) => {
      saved = next;
    },
    read: (next: typeof read) => {
      read = next;
    },
    run: (next: typeof run) => {
      run = next;
    },
  };
}

test("startup cannot overwrite completion that arrives after its initial scan", async () => {
  const f = fixture();
  f.probe(() => {
    f.save({
      ...f.saved,
      status: "completed",
      lead: { ...f.saved.lead, status: "completed", lastReport: "done" },
    });
    return false;
  });
  assert.equal((await f.service.read(f.id)).status, "completed");
  assert.equal(f.saved.lead.lastReport, "done");
  assert.equal(f.writes, 0);
  await f.service.dispose();
});

test("a late idle read cannot replace the live task after a new run starts", async () => {
  const f = fixture();
  f.owner(true);
  await f.service.read(f.id);
  f.owner(false);
  f.save({ ...f.saved, status: "completed", lead: { ...f.saved.lead, status: "completed" } });
  let releaseRead!: () => void, entered!: () => void, releaseModel!: () => void;
  const held = new Promise<void>((r) => {
    releaseRead = r;
  });
  const reached = new Promise<void>((r) => {
    entered = r;
  });
  const model = new Promise<void>((r) => {
    releaseModel = r;
  });
  let first = true;
  f.read(async () => {
    const snapshot = structuredClone(f.saved);
    if (first) {
      first = false;
      entered();
      await held;
    }
    return snapshot;
  });
  f.run(async () => {
    await model;
    return { text: "done" };
  });
  const pending = f.service.read(f.id);
  await reached;
  await f.service.submit({ taskId: f.id, requestId: "new", text: "continue" });
  releaseRead();
  assert.equal((await pending).status, "running");
  releaseModel();
  for (let i = 0; i < 30 && f.saved.status !== "completed"; i++)
    await new Promise<void>((r) => setImmediate(r));
  assert.equal(f.saved.status, "completed");
  await f.service.dispose();
});

test("an already open host recovers a dead owner on read and does not auto-run", async () => {
  const f = fixture();
  f.owner(true);
  assert.equal((await f.service.read(f.id)).status, "running");
  f.owner(false);
  const recovered = await f.service.read(f.id);
  assert.equal(recovered.status, "error");
  assert.equal(recovered.lead.sessionId, "native-preserved");
  assert.equal(recovered.events.at(-1)?.kind, "error");
  assert.equal(recovered.events.at(-1)?.at, "2026-10-11T00:00:03.000Z");
  assert.equal(f.calls, 0);
  await f.service.dispose();
});

test("concurrent readers record an interrupted turn only once", async () => {
  const f = fixture();
  f.owner(true);
  await f.service.read(f.id);
  f.owner(false);
  const snapshots = await Promise.all([f.service.read(f.id), f.service.read(f.id)]);
  assert(snapshots.every((task) => task.status === "error"));
  assert.equal(f.saved.events.filter((event) => event.kind === "error").length, 1);
  assert.equal(f.writes, 1);
  await f.service.dispose();
});

test("list and configure can recover a dead owner, while active foreign tasks stay untouched", async () => {
  for (const command of ["list", "configure"] as const) {
    const f = fixture();
    f.owner(true);
    await f.service.read(f.id);
    assert.equal(f.writes, 0);
    f.owner(false);
    const result =
      command === "list"
        ? (await f.service.list("D:/sandbox"))[0]!
        : await f.service.configure({
            taskId: f.id,
            preferences: {
              dual: false,
              lead: { harness: "pi" },
              sidekick: { harness: "pi" },
              mode: "plan",
            },
          });
    assert.equal(result.status, "error");
    assert.equal(f.calls, 0);
    await f.service.dispose();
  }
});
