import test from "node:test";
import assert from "node:assert/strict";
import { nativeDeltaEvent } from "./stream-event.js";
test("正文与迟到思考沿用各自内容块身份，不按到达时间切段", () => {
  const first = nativeDeltaEvent(
    { type: "thinking_delta", contentIndex: 0, delta: "Think" },
    "reply",
  );
  const text = nativeDeltaEvent({ type: "text_delta", contentIndex: 1, delta: "我来" }, "reply");
  const late = nativeDeltaEvent({ type: "thinking_delta", contentIndex: 0, delta: "." }, "reply");
  assert.equal(first?.blockId, late?.blockId);
  assert.notEqual(text?.blockId, late?.blockId);
  assert.notEqual(
    text?.blockId,
    nativeDeltaEvent({ type: "text_delta", contentIndex: 1, delta: "下一轮" }, "next")?.blockId,
  );
  assert.equal(nativeDeltaEvent({ type: "toolcall_delta" }, "reply"), undefined);
});
