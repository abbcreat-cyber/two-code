import test from "node:test";
import assert from "node:assert/strict";
import { handoffEnvelope, handoffHistory } from "../domain/handoffs.js";
import { newTask } from "../domain/task.js";
import { parseTask } from "../domain/snapshot.js";
import { verificationReport } from "../domain/verification-report.js";
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

test("历次副手原生回执跨页逐字恢复，不混入主手对话，不把旧成功当本轮证据", () => {
  const task = newTask(
    "00000000-0000-4000-8000-000000000003",
    {
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    "2026-10-11T04:00:00Z",
  );
  const at = task.updatedAt;
  task.events = [
    { seq: 1, at, role: "user", kind: "message", text: "已授权的小任务" },
    { seq: 2, at, role: "lead", kind: "message", text: "主手私有上下文" },
    { seq: 3, at, role: "lead", kind: "handoff", text: "验证", handoffUserSeq: 1 },
    ...Array.from({ length: 20 }, (_, i) => ({
      seq: i + 4,
      at,
      role: "sidekick" as const,
      kind: "verification" as const,
      toolCallId: `native-${i}`,
      text: JSON.stringify({
        tool: "PowerShell",
        status: i === 19 ? "failed" : "completed",
        reportedExitCode: i === 19 ? 7 : 0,
        summaries: Array.from({ length: 8 }, () => "PASS " + "校验".repeat(70)),
      }),
    })),
    {
      seq: 24,
      at,
      role: "lead",
      kind: "verification",
      toolCallId: "lead-private",
      text: "主手回执",
    },
    { seq: 25, at, role: "sidekick", kind: "handoff_report", text: "模型自述：通过" },
    { seq: 26, at, role: "lead", kind: "handoff", text: "输入已改，下一轮" },
  ];
  const restored = parseTask(JSON.parse(JSON.stringify(task)));
  let text = "",
    offset = 0,
    pages = 0;
  while (true) {
    const page = JSON.parse(handoffHistory(restored, offset));
    assert.equal(page.offset, offset);
    text += page.text;
    pages++;
    if (page.nextOffset === null) break;
    assert.equal(page.nextOffset, offset + 20000);
    offset = page.nextOffset;
  }
  const entries = JSON.parse(text);
  const receipts = entries.filter((e: { kind: string }) => e.kind === "verification");
  assert(pages > 1);
  assert.equal(receipts.length, 20);
  assert.deepEqual(
    receipts.map((e: { seq: number }) => e.seq),
    Array.from({ length: 20 }, (_, i) => i + 4),
  );
  for (const receipt of receipts) {
    const original = task.events.find((e) => e.seq === receipt.seq)!;
    assert.equal(receipt.text, original.text);
    assert.equal(receipt.toolCallId, original.toolCallId);
    assert.equal(receipt.role, "sidekick");
  }
  assert.equal(entries[0].userRequirements, "已授权的小任务");
  assert(!text.includes("主手私有上下文"));
  assert(!text.includes("主手回执"));
  assert(!text.includes("lead-private"));
  assert.equal(verificationReport(restored), "");
});
