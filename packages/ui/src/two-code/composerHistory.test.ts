import test from "node:test";
import assert from "node:assert/strict";
import type { TwoCodeTask } from "@zcode/services";
import { twoCodePromptHistory } from "./composerHistory.js";
import { imageMessage } from "./imageMessage.js";

test("输入历史按用户事件排序，排除派工与未送达输入；附图不泄露内部载体", () => {
  const task = {
    events: [
      { seq: 1, at: "a", role: "user", kind: "message", text: "first" },
      { seq: 2, at: "b", role: "lead", kind: "handoff", text: "private brief" },
      {
        seq: 3,
        at: "c",
        role: "user",
        kind: "message",
        text: "not delivered",
        requestId: "failed",
      },
      {
        seq: 4,
        at: "d",
        role: "system",
        kind: "error",
        text: "fail",
        requestId: "failed",
        deliveryFailed: true,
      },
      {
        seq: 5,
        at: "e",
        role: "user",
        kind: "message",
        text: imageMessage("看图", [{ name: "a.png", path: "D:/qa/a.png", mime: "image/png" }]),
      },
    ],
  } as TwoCodeTask;
  assert.deepEqual(twoCodePromptHistory([task]), ["first", "看图"]);
});
test("重开投影有界且仅合并连续重复输入", () => {
  const task = {
    events: Array.from({ length: 40 }, (_, i) => ({
      seq: i,
      at: String(i).padStart(3, "0"),
      role: "user",
      kind: "message",
      text: `input ${i}`,
    })),
  } as TwoCodeTask;
  const history = twoCodePromptHistory([JSON.parse(JSON.stringify(task))]);
  assert.equal(history.length, 30);
  assert.equal(history[0], "input 10");
  task.events.push({ ...task.events.at(-1)!, seq: 41 });
  assert.deepEqual(twoCodePromptHistory([task]), history);
});
