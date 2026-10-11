import test from "node:test";
import assert from "node:assert/strict";
import { NativeToolProgress } from "./tool-input-progress.js";
test("Step精简RPC按块编号关联调用ID，不依赖完整partial消息", () => {
  const p = new NativeToolProgress();
  p.pi(
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 1,
        id: "native-step",
        toolName: "write_file",
      },
    },
    0,
  );
  const e = p.pi(
    {
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "<svg/>" },
    },
    300,
  )!;
  assert.equal(e.toolCallId, "native-step");
  assert.equal(JSON.parse(e.text).preview, "<svg/>");
});
test("原生工具分片在执行前可见，合并更新并保留结束尾部", () => {
  const p = new NativeToolProgress();
  const delta = (type: string, text = "") => ({
    type: "message_update",
    assistantMessageEvent: {
      type,
      contentIndex: 0,
      delta: text,
      partial: { content: [{ id: "a", name: "write_file" }] },
    },
  });
  assert.equal(p.pi(delta("toolcall_start"), 0)?.kind, "tool_input");
  assert.equal(p.pi(delta("toolcall_delta", "{"), 1), undefined);
  const event = p.pi(delta("toolcall_delta", "x".repeat(600)), 2)!;
  assert.equal(JSON.parse(event.text).characters, 601);
  assert.equal(JSON.parse(event.text).preview.length, 601);
  const end = p.pi(
    {
      ...delta("toolcall_end"),
      assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "a", name: "write_file" } },
    },
    3,
  )!;
  assert.equal(end.toolCallId, "a");
  assert.equal(p.pi({ type: "tool_execution_end", toolCallId: "a", isError: true })?.text, "error");
});
test("草稿有界，命令参数不记录，Claude原生输入也能恢复", () => {
  const p = new NativeToolProgress();
  p.claude(
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "c", name: "Write" },
    },
    0,
  );
  const e = p.claude(
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "字".repeat(22000) },
    },
    1,
  )!;
  assert.equal(JSON.parse(e.text).preview.length, 20000);
  assert.equal(JSON.parse(e.text).characters, 22000);
  assert.equal(JSON.parse(e.text).bytes, 66000);
  p.claude(
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "b", name: "PowerShell" },
    },
    2,
  );
  const hidden = p.claude(
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "sensitive-command" },
    },
    300,
  )!;
  assert.equal(JSON.parse(hidden.text).preview, undefined);
  assert(!hidden.text.includes("sensitive-command"));
  assert(p.claude({ type: "content_block_stop", index: 0 }, 301));
});
