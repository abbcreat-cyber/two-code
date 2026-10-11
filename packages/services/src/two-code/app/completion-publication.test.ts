import test from "node:test";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "./coordinator.js";
import type { TwoCodeTask } from "../contract.js";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};

test("终态在适配器清理和租约释放后发布，完成回调可立即续问", async () => {
  const closing = gate(),
    finishClose = gate(),
    releasing = gate(),
    finishRelease = gate();
  let calls = 0,
    lease = false;
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
    createAdapter: () => {
      const number = ++calls;
      return {
        run: async () => ({ text: "完成" }),
        cancel: async () => {},
        close: async () => {
          if (number === 1) {
            closing.release();
            await finishClose.promise;
          }
        },
      };
    },
    lease: {
      isActive: async () => lease,
      acquire: async () => {
        assert.equal(lease, false);
        lease = true;
        return async () => {
          if (calls === 1) {
            releasing.release();
            await finishRelease.promise;
          }
          lease = false;
        };
      },
    },
  });
  const task = await service.create({
    workspacePath: "D:/fixture",
    dual: false,
    lead: { harness: "step-code" },
    sidekick: { harness: "claude-code" },
  });
  let continuation: Promise<unknown> | undefined;
  const continued = gate();
  service.onDidChange((t) => {
    if (t.status === "completed" && !continuation) {
      continuation = service.submit({ taskId: t.id, requestId: "next", text: "马上继续" });
      void continuation.finally(continued.release);
    }
  });
  await service.submit({ taskId: task.id, requestId: "first", text: "执行" });
  await closing.promise;
  assert.equal((await service.read(task.id)).status, "running");
  assert.equal(continuation, undefined);
  finishClose.release();
  await releasing.promise;
  assert.equal((await service.read(task.id)).status, "running");
  assert.equal(continuation, undefined);
  const stoppedAfterExecution = service.cancel(task.id);
  finishRelease.release();
  await continued.promise;
  await continuation;
  assert.notEqual((await stoppedAfterExecution).status, "cancelled", "已进入终态提交不能倒改结果");
  assert.equal(calls, 2);
  await service.dispose();
});
