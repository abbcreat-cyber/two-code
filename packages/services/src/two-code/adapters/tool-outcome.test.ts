import test from "node:test";
import assert from "node:assert/strict";
import { rejectedToolEvent } from "./tool-outcome.js";

test("原生门禁拒绝关联原工具，普通失败和中断不伪装未执行", () => {
  const record = {
    isError: true,
    toolCallId: "old-command",
    result: {
      content: [
        { type: "text", text: "[two-code-permission-denied] 本次powershell请求未获Two Code许可。" },
      ],
    },
  };
  const denied = rejectedToolEvent(record)!;
  assert.equal(denied.event.toolCallId, "old-command");
  assert.equal(denied.event.notExecuted, true);
  assert.match(denied.event.text, /未获批准/);
  assert.equal(denied.stopped, false);
  assert.equal(rejectedToolEvent({ ...record, isError: false }), undefined);
  for (const result of ["interrupted", "Process exited with code 1", "ENOENT"])
    assert.equal(rejectedToolEvent({ ...record, result }), undefined);
  assert.equal(
    rejectedToolEvent({ ...record, result: "[desktop-opening-stopped] 尚未执行" })?.stopped,
    true,
  );
});
