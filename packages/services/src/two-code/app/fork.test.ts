import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import { newTask } from "../domain/task.js";
import { parseTask } from "../domain/snapshot.js";
import type { TwoCodeTask } from "../contract.js";
test("分叉截断事件、独立身份、清空准入账本，重复请求及重开幂等", async () => {
  const source = newTask(
    "00000000-0000-4000-8000-000000000001",
    {
      workspacePath: "D:/qa",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    "now",
  );
  source.status = "completed";
  source.lead.sessionId = "lead-original";
  source.sidekick.sessionId = "side-original";
  source.requestIds = ["old"];
  source.events = [
    { seq: 1, at: "a", role: "user", kind: "message", text: "A" },
    { seq: 2, at: "b", role: "lead", kind: "message", text: "answer A" },
    { seq: 3, at: "c", role: "lead", kind: "status", text: "执行已结束" },
    { seq: 4, at: "d", role: "user", kind: "message", text: "B" },
    { seq: 5, at: "e", role: "lead", kind: "status", text: "执行已结束" },
  ];
  const saved = new Map([[source.id, source]]);
  let calls = 0;
  const deps = {
    sessionRoot: "D:/qa",
    store: {
      load: async () => [...saved.values()].map((t) => structuredClone(t)),
      read: async (id: string) => structuredClone(saved.get(id)),
      save: async (t: TwoCodeTask) => {
        saved.set(t.id, parseTask(t));
      },
    },
    catalog: async () => [],
    validateWorkspace: async (p: string) => p,
    createAdapter: () => ({
      run: async () => {
        throw Error("fork must not run models");
      },
      cancel: async () => {},
      close: async () => {},
    }),
    forkActors: async () => {
      calls++;
      return { lead: "lead-branch", sidekick: "side-branch" };
    },
  };
  const service = new TwoCodeCoordinator(deps);
  const request = { taskId: source.id, atSeq: 3, requestId: "fork1" };
  const [a, b] = await Promise.all([service.fork(request), service.fork(request)]);
  assert.equal(a.id, b.id);
  assert.equal(calls, 1);
  assert.equal(a.events.at(-1)?.seq, 3);
  assert.deepEqual(a.requestIds, []);
  assert.deepEqual(a.permissions, []);
  assert.deepEqual(a.usage, []);
  assert.deepEqual(saved.get(source.id), source);
  assert.notEqual(a.lead.sessionId, source.lead.sessionId);
  await assert.rejects(service.fork({ ...request, atSeq: 2 }), /冲突/);
  await assert.rejects(service.fork({ ...request, requestId: "invalid", atSeq: 2 }), /已完成/);
  await service.dispose();
  const reopened = new TwoCodeCoordinator(deps);
  assert.equal((await reopened.fork(request)).id, a.id);
  assert.equal(calls, 1);
  await reopened.dispose();
});
