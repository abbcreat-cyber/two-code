import test from "node:test";
import assert from "node:assert/strict";
import { newTask, appendEvent } from "../domain/task.js";
import type { TwoCodeTask } from "../contract.js";
import { TaskSnapshotPublisher } from "./task-snapshot-publisher.js";

const fixture = () =>
  newTask(
    "fixture",
    {
      workspacePath: "D:/test",
      dual: true,
      lead: { harness: "claude-code" },
      sidekick: { harness: "pi" },
    },
    new Date().toISOString(),
  );

test("10,000 deltas retain every event but produce bounded immutable snapshots", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const task = fixture();
  task.status = "running";
  const sent: TwoCodeTask[] = [];
  const publisher = new TaskSnapshotPublisher((snapshot) => sent.push(snapshot));
  for (let i = 0; i < 10000; i++) {
    appendEvent(
      task,
      { role: "lead", kind: "reasoning", text: String(i), blockId: "one" },
      new Date().toISOString(),
    );
    publisher.publish(task, true);
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.events.length, 1);
  t.mock.timers.tick(100);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.events.length, 10000);
  assert.deepEqual(sent[1]!.events, task.events);
  publisher.dispose();
});

test("permission and terminal snapshots bypass throttling; no stale running packet follows cancellation", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const task = fixture();
  task.status = "running";
  const sent: TwoCodeTask[] = [];
  const publisher = new TaskSnapshotPublisher((snapshot) => sent.push(snapshot));
  publisher.publish(task, true);
  publisher.publish(task, true);
  task.permissions.push({ id: "ask", role: "lead", title: "Read", detail: "test" });
  publisher.publish(task);
  assert.equal(sent.at(-1)!.permissions.length, 1);
  publisher.publish(task, true);
  publisher.publish(task, true);
  task.status = "cancelled";
  publisher.publish(task);
  const count = sent.length;
  t.mock.timers.tick(1000);
  assert.equal(sent.length, count);
  assert.equal(sent.at(-1)!.status, "cancelled");
  publisher.dispose();
});

test("continuous streams remain visible every 100ms; dispose clears all pending tasks", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const task = fixture();
  task.status = "running";
  const sent: TwoCodeTask[] = [];
  const publisher = new TaskSnapshotPublisher((snapshot) => sent.push(snapshot));
  for (let i = 0; i < 25; i++) {
    publisher.publish(task, true);
    t.mock.timers.tick(10);
  }
  assert.equal(sent.length, 3);
  publisher.dispose();
  t.mock.timers.tick(1000);
  assert.equal(sent.length, 3);
});
