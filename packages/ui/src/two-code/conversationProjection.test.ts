import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import type { TwoCodeTask } from "@zcode/services";
import { projectTwoCodeRows } from "./conversationProjection.js";
const base: TwoCodeTask = {
  id: "fixture",
  title: "任务",
  workspacePath: "D:/fixture",
  dual: true,
  status: "running",
  updatedAt: "2026-10-10T10:00:00Z",
  lead: { selection: { harness: "claude-code" }, status: "running" },
  sidekick: { selection: { harness: "pi" }, status: "running" },
  permissions: [],
  requestIds: [],
  events: [],
};
test("native rows preserve identities during streaming and render handoff without duplicating child text", () => {
  const task = structuredClone(base);
  const add = (
    role: TwoCodeTask["events"][number]["role"],
    kind: TwoCodeTask["events"][number]["kind"],
    text: string,
  ) => task.events.push({ seq: task.events.length + 1, at: task.updatedAt, role, kind, text });
  add("user", "message", "验证乘法");
  add("lead", "message", "交给");
  add("lead", "message", "副手。");
  add("lead", "handoff", "算17*19");
  add("sidekick", "message", "323");
  const first = projectTwoCodeRows(task);
  first.forEach((r) => conversationRowSchema.parse(r));
  assert.equal(first.filter((r) => r.kind === "assistantText").length, 1);
  assert.equal(first.find((r) => r.kind === "toolCall")?.output?.text, "323");
  add("sidekick", "status", "执行已结束，待核对结果");
  add("lead", "message", "**323**，核对通过。");
  task.status = "completed";
  const final = projectTwoCodeRows(task);
  final.forEach((r) => conversationRowSchema.parse(r));
  assert.deepEqual(
    final.slice(0, first.length).map((r) => r.rowId),
    first.map((r) => r.rowId),
  );
  assert.equal(final.find((r) => r.kind === "turnHeader")?.state, "completedSuccess");
  assert.equal(final.find((r) => r.kind === "toolCall")?.status, "success");
  assert.equal(new Set(final.map((r) => r.rowId)).size, final.length);
});
test("cancelled handoff never appears as success in native timeline", () => {
  const task = structuredClone(base);
  task.status = "cancelled";
  task.sidekick.status = "cancelled";
  task.events = [
    { seq: 1, at: task.updatedAt, role: "user", kind: "message", text: "运行" },
    { seq: 2, at: task.updatedAt, role: "lead", kind: "handoff", text: "执行" },
  ];
  const rows = projectTwoCodeRows(task);
  assert.equal(rows.find((r) => r.kind === "turnHeader")?.state, "completedInterrupted");
  assert.equal(rows.find((r) => r.kind === "toolCall")?.status, "cancelled");
});

test("saving model preferences cannot extend a completed turn duration", () => {
  const task = structuredClone(base);
  task.status = "completed";
  task.events = [
    { seq: 1, at: "2026-10-10T10:00:00Z", role: "user", kind: "message", text: "hi" },
    { seq: 2, at: "2026-10-10T10:00:03Z", role: "lead", kind: "message", text: "hello" },
  ];
  task.updatedAt = "2026-10-10T11:00:00Z";
  const header = projectTwoCodeRows(task).find((r) => r.kind === "turnHeader")!;
  assert.equal(header.endedAt! - header.startedAt, 3000);
});

test("reasoning uses native rows, survives snapshot replay and stays out of answer text", () => {
  const task = structuredClone(base);
  const add = (
    role: TwoCodeTask["events"][number]["role"],
    kind: TwoCodeTask["events"][number]["kind"],
    text: string,
  ) => task.events.push({ seq: task.events.length + 1, at: task.updatedAt, role, kind, text });
  add("user", "message", "检查");
  add("lead", "reasoning", "主手片段一");
  add("lead", "reasoning", "片段二");
  const streaming = projectTwoCodeRows(task).find((r) => r.kind === "reasoning")!;
  assert.equal(streaming.state, "streaming");
  add("lead", "reasoning", "");
  add("lead", "handoff", "核对");
  add("sidekick", "reasoning", "副手真实片段");
  add("sidekick", "message", "核对完成");
  add("lead", "message", "最后答案");
  task.status = "completed";
  const rows = projectTwoCodeRows(JSON.parse(JSON.stringify(task)));
  rows.forEach((r) => conversationRowSchema.parse(r));
  const thoughts = rows.filter((r) => r.kind === "reasoning");
  assert.equal(thoughts.length, 2);
  assert.equal(thoughts[0]!.rowId, streaming.rowId);
  assert.match(thoughts[0]!.text, /主手片段一片段二/);
  assert.match(thoughts[1]!.text, /副手真实片段/);
  assert.equal(
    rows
      .filter((r) => r.kind === "assistantText")
      .map((r) => r.text)
      .join(""),
    "最后答案",
  );
  task.events = task.events.slice(0, 3);
  task.status = "cancelled";
  assert.equal(projectTwoCodeRows(task).find((r) => r.kind === "reasoning")?.state, "interrupted");
});
