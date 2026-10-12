import test from "node:test";
import assert from "node:assert/strict";
import { newTask, appendEvent } from "../domain/task.js";
import { readSidekick } from "./sidekick-handoff.js";
import type { ActiveRun } from "./active-run.js";

function fixture() {
  const task = newTask(
    "test",
    {
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "pi" },
      sidekick: { harness: "pi" },
    },
    "2026-10-12",
  );
  const run: ActiveRun = {
    id: "new-run",
    requestId: "new-request",
    abort: new AbortController(),
    actors: new Map(),
    permissions: new Map(),
  };
  const add = (kind: "handoff" | "handoff_report" | "verification", text: string) =>
    appendEvent(task, { role: kind === "handoff" ? "lead" : "sidekick", kind, text }, "2026-10-12");
  return { task, run, add };
}
test("续问无本轮派工时返回状态与历史入口，不伪造本轮报告", async () => {
  const { task, run, add } = fixture();
  add("handoff", "旧派工");
  add("verification", '{"status":"completed"}');
  add("handoff_report", "OLD_REPORT");
  const before = structuredClone(task);
  const text = await readSidekick(task, run, () => {});
  assert.match(text, /本轮.*没有.*报告/);
  assert.match(text, /历史.*已收到/);
  assert.match(text, /read_handoff_history/);
  assert(!text.includes("OLD_REPORT"));
  assert.equal(run.sidekickRead, undefined);
  assert.deepEqual(task, before);
});
test("最近交接未完成时不能拿更早报告背书，空任务也不产生派工", async () => {
  const { task, run, add } = fixture();
  assert.match(await readSidekick(task, run, () => {}), /尚无历史派工/);
  add("handoff", "第一次");
  add("handoff_report", "EARLIER_REPORT");
  add("handoff", "第二次");
  const text = await readSidekick(task, run, () => {});
  assert.match(text, /历史.*未取得/);
  assert(!text.includes("EARLIER_REPORT"));
  assert.equal(run.sidekick, undefined);
});
test("存在本轮pending仍等待真实报告，失败不得退回历史", async () => {
  const { task, run, add } = fixture();
  add("handoff", "旧任务");
  add("handoff_report", "OLD");
  run.sidekick = Promise.resolve("NEW_REPORT");
  assert.match(await readSidekick(task, run, () => {}), /NEW_REPORT/);
  assert.equal(run.sidekickRead, true);
  run.sidekick = Promise.reject(Error("native failed"));
  await assert.rejects(
    readSidekick(task, run, () => {}),
    /native failed/,
  );
});
