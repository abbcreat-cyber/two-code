import test from "node:test";
import assert from "node:assert/strict";
import type { TwoCodeTask } from "@zcode/services";
import { projectTwoCodeRows } from "./conversationProjection.js";

test("ZCode自有MCP派工参数草稿与实际交接只有一行，原生ID不改写", () => {
  const at = "2026-10-12T00:00:00Z";
  const task: TwoCodeTask = {
    id: "fixture",
    title: "fixture",
    workspacePath: "D:/fixture",
    dual: true,
    status: "completed",
    updatedAt: at,
    lead: { selection: { harness: "zcode" }, status: "completed" },
    sidekick: { selection: { harness: "pi" }, status: "completed" },
    permissions: [],
    requestIds: [],
    events: [
      { seq: 1, at, role: "user", kind: "message", text: "开始" },
      {
        seq: 2,
        at,
        role: "lead",
        kind: "tool_input",
        toolCallId: "native-call",
        text: JSON.stringify({ tool: "mcp__two_code__sidekick", characters: 20, bytes: 20 }),
      },
      {
        seq: 3,
        at,
        role: "lead",
        kind: "tool",
        toolCallId: "native-call",
        text: "mcp__two_code__sidekick",
      },
      { seq: 4, at, role: "lead", kind: "handoff", text: "读取" },
      { seq: 5, at, role: "sidekick", kind: "tool", toolCallId: "read-call", text: "Read" },
      { seq: 6, at, role: "sidekick", kind: "handoff_report", text: "已完成" },
      { seq: 7, at, role: "lead", kind: "tool_end", toolCallId: "native-call", text: "success" },
      { seq: 8, at, role: "lead", kind: "message", text: "已完成" },
    ],
  };
  const tools = projectTwoCodeRows(task).filter((r) => r.kind === "toolCall");
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.toolName, "sidekick");
  assert.match(tools[0]?.output?.text ?? "", /调用工具：Read/);
  assert.equal(task.events[1]?.toolCallId, "native-call");
});
