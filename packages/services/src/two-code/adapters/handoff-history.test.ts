import test from "node:test";
import assert from "node:assert/strict";
import { handoffEnvelope, handoffHistory } from "../domain/handoffs.js";
import { newTask } from "../domain/task.js";
import { parseTask } from "../domain/snapshot.js";
test("历史逐字持久并可分页恢复；标签由框架确定，模型不必重复包装", () => {
  assert.equal(
    (handoffEnvelope("<lead_handoff>exact</lead_handoff>").match(/<lead_handoff>/g) ?? []).length,
    1,
  );
  assert.match(handoffEnvelope("change", true), /<lead_update>\nchange/);
  const task = newTask(
    "00000000-0000-4000-8000-000000000002",
    {
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    "2026-10-11T04:00:00Z",
  );
  const brief = "准确代码\n" + "文字 $ & <xml>\n".repeat(2400);
  task.events = [
    { seq: 1, at: task.updatedAt, role: "lead", kind: "handoff", text: brief },
    {
      seq: 2,
      at: task.updatedAt,
      role: "sidekick",
      kind: "handoff_report",
      text: "证据路径 D:/fixture/out.log\nexit=0",
    },
  ];
  const restored = parseTask(JSON.parse(JSON.stringify(task)));
  let text = "",
    offset = 0;
  while (true) {
    const page = JSON.parse(handoffHistory(restored, offset));
    text += page.text;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  const history = JSON.parse(text);
  assert.equal(history[0].text, brief);
  assert.equal(history[1].text, task.events[1]!.text);
  assert.throws(() => handoffHistory(restored, -1), /位置无效/);
});
