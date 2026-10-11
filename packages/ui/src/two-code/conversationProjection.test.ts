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

for (const identified of [false, true])
  test(`迟到思考尾部不拆开一句话：${identified ? "原生块身份" : "旧记录"}`, () => {
    const task = structuredClone(base);
    const values = [
      ["user", "message", "检查"],
      ["lead", "reasoning", "Let me"],
      ["lead", "message", "我来"],
      ["lead", "reasoning", "."],
      ["lead", "message", "查一下。"],
      ["lead", "tool", "search_web"],
      ["lead", "reasoning", "Answer"],
      ["lead", "message", "打"],
      ["lead", "reasoning", "."],
      ["lead", "message", "对了。"],
    ] as const;
    task.events = values.map(([role, kind, text], i) => ({
      seq: i + 1,
      at: task.updatedAt,
      role,
      kind,
      text,
      ...(identified && (kind === "reasoning" || (role === "lead" && kind === "message"))
        ? { blockId: `response${i < 5 ? 1 : 2}:${kind === "reasoning" ? 0 : 1}` }
        : {}),
    }));
    const rows = projectTwoCodeRows(task);
    assert.deepEqual(
      rows.filter((r) => r.kind === "assistantText").map((r) => r.text),
      ["我来查一下。", "打对了。"],
    );
    assert.equal(rows.filter((r) => r.kind === "reasoning").length, 2);
    assert(rows.filter((r) => r.kind === "reasoning").every((r) => r.text.endsWith(".")));
    rows.forEach((r) => conversationRowSchema.parse(r));
  });

test("开场门禁回执将原工具尝试改为未执行，重放不重复也不伪造成功", () => {
  const task = structuredClone(base);
  task.events = [
    { seq: 1, at: task.updatedAt, role: "user", kind: "message", text: "检查文件" },
    {
      seq: 2,
      at: task.updatedAt,
      role: "lead",
      kind: "tool",
      text: "read_file",
      toolCallId: "native-one",
    },
    {
      seq: 3,
      at: task.updatedAt,
      role: "lead",
      kind: "tool",
      text: "工具尚未执行，等待补充开场说明。",
      toolCallId: "native-one",
      notExecuted: true,
    },
    { seq: 4, at: task.updatedAt, role: "lead", kind: "message", text: "我先检查指定文件。" },
    {
      seq: 5,
      at: task.updatedAt,
      role: "lead",
      kind: "tool",
      text: "read_file",
      toolCallId: "native-two",
    },
  ];
  const rows = projectTwoCodeRows(JSON.parse(JSON.stringify(task)));
  rows.forEach((r) => conversationRowSchema.parse(r));
  const tools = rows.filter(
    (r) => r.kind === "timelineMarker" && r.marker.type === "harnessActivity",
  );
  assert.equal(tools.length, 2);
  assert.equal(tools[0]!.rowId, 20);
  assert.match(JSON.stringify(tools[0]), /工具尚未执行/);
  assert(!JSON.stringify(tools[0]).includes("success"));
  assert.match(JSON.stringify(tools[1]), /调用工具 · read_file/);
});
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

test("不同任务的相同事件序号不共享原版工具展开状态", () => {
  const first = structuredClone(base);
  first.events = [
    { seq: 1, at: first.updatedAt, role: "user", kind: "message", text: "工作" },
    { seq: 2, at: first.updatedAt, role: "lead", kind: "handoff", text: "派工" },
  ];
  const second = { ...structuredClone(first), id: "other-task" };
  const a = projectTwoCodeRows(first),
    b = projectTwoCodeRows(second);
  assert.notEqual(
    a.find((r) => r.kind === "toolCall")!.toolCallId,
    b.find((r) => r.kind === "toolCall")!.toolCallId,
  );
  assert.notEqual(
    a.find((r) => r.kind === "turnHeader")!.turnId,
    b.find((r) => r.kind === "turnHeader")!.turnId,
  );
});

test("运行中用户补充不取消旧交接，也不丢失其后到达的副手报告", () => {
  const task = structuredClone(base);
  task.events = [
    { seq: 1, at: task.updatedAt, role: "user", kind: "message", text: "先做" },
    { seq: 2, at: task.updatedAt, role: "lead", kind: "handoff", text: "旧brief" },
    {
      seq: 3,
      at: task.updatedAt,
      role: "user",
      kind: "message",
      text: "改一下",
      continuation: true,
    },
    { seq: 4, at: task.updatedAt, role: "lead", kind: "handoff_update", text: "新brief" },
    { seq: 5, at: task.updatedAt, role: "sidekick", kind: "message", text: "新结果" },
  ];
  const rows = projectTwoCodeRows(task);
  rows.forEach((r) => conversationRowSchema.parse(r));
  const tool = rows.find((r) => r.kind === "toolCall")!;
  assert.equal(tool.status, "running");
  assert.match(tool.inputText, /新brief/);
  assert.equal(tool.output?.text, "新结果");
  assert.equal(rows.filter((r) => r.kind === "turnHeader").length, 1);
  assert.equal(rows.filter((r) => r.kind === "userInput").length, 2);
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

test("a resumed successful task preserves the cancelled turn and stops its historical sidekick", () => {
  const task = structuredClone(base);
  task.status = "completed";
  task.sidekick.status = "completed";
  task.events = [
    { seq: 1, at: "2026-10-10T10:00:00Z", role: "user", kind: "message", text: "运行" },
    { seq: 2, at: "2026-10-10T10:00:01Z", role: "lead", kind: "handoff", text: "计算" },
    { seq: 3, at: "2026-10-10T10:00:02Z", role: "sidekick", kind: "reasoning", text: "检查" },
    {
      seq: 4,
      at: "2026-10-10T10:00:03Z",
      role: "system",
      kind: "status",
      text: "正在停止主手与副手",
    },
    { seq: 5, at: "2026-10-10T10:00:03Z", role: "system", kind: "error", text: "Pi 任务已停止" },
    { seq: 6, at: "2026-10-10T11:00:00Z", role: "user", kind: "message", text: "继续" },
    { seq: 7, at: "2026-10-10T11:00:04Z", role: "lead", kind: "message", text: "完成" },
    {
      seq: 8,
      at: "2026-10-10T11:00:05Z",
      role: "lead",
      kind: "status",
      text: "执行已结束，待核对结果",
    },
  ];
  const rows = projectTwoCodeRows(task);
  rows.forEach((r) => conversationRowSchema.parse(r));
  const turns = rows.filter((r) => r.kind === "turnHeader");
  assert.deepEqual(
    turns.map((r) => r.state),
    ["completedInterrupted", "completedSuccess"],
  );
  assert.equal(turns[0]!.endedAt! - turns[0]!.startedAt, 3000);
  assert.equal(rows.find((r) => r.kind === "toolCall")?.status, "cancelled");
  assert.equal(rows.find((r) => r.kind === "reasoning")?.state, "interrupted");
});

test("historical elapsed work excludes the idle gap before the next user turn", () => {
  for (const withTerminal of [false, true]) {
    const task = structuredClone(base);
    task.status = "completed";
    task.events = [
      { seq: 1, at: "2026-10-10T10:00:00Z", role: "user", kind: "message", text: "第一轮" },
      { seq: 2, at: "2026-10-10T10:00:03Z", role: "lead", kind: "message", text: "完成" },
      ...(withTerminal
        ? [
            {
              seq: 3,
              at: "2026-10-10T10:00:03Z",
              role: "lead" as const,
              kind: "status" as const,
              text: "执行已结束，待核对结果",
            },
          ]
        : []),
      { seq: 4, at: "2026-10-10T11:00:00Z", role: "user", kind: "message", text: "第二轮" },
      { seq: 5, at: "2026-10-10T11:00:04Z", role: "lead", kind: "message", text: "完成" },
    ];
    const turn = projectTwoCodeRows(task).find((r) => r.kind === "turnHeader")!;
    assert.equal(turn.endedAt! - turn.startedAt, 3000);
  }
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
