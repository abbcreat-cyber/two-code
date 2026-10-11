import test from "node:test";
import assert from "node:assert/strict";
import { verificationEvent, nativeVerificationEvent } from "./verification-receipts.js";
import { verificationReport } from "../domain/verification-report.js";
import { newTask } from "../domain/task.js";
import { parseTask } from "../domain/snapshot.js";
test("执行器摘要保留真实退出状态，不把缺少退出码当0，也不保存凭据输出", () => {
  const event = verificationEvent(
    "PowerShell",
    "a",
    "3 checks passed\nAPI_KEY=private\nPASS token=private\nEXITCODE=0",
    false,
  )!;
  const data = JSON.parse(event.text);
  assert.equal(data.status, "completed");
  assert.equal(data.reportedExitCode, 0);
  assert.deepEqual(data.summaries, ["3 checks passed", "EXITCODE=0"]);
  assert(!event.text.includes("private"));
  assert.equal(
    JSON.parse(verificationEvent("bash", "b", "FAIL: check\nExit code: 1", true)!.text).status,
    "failed",
  );
  assert.equal(
    JSON.parse(verificationEvent("bash", "b", "", false, true)!.text).status,
    "interrupted",
  );
  assert(
    !("reportedExitCode" in JSON.parse(verificationEvent("bash", "b", "output", false)!.text)),
  );
  assert.equal(verificationEvent("Read", "c", "secret file", false), undefined);
  assert.equal(
    nativeVerificationEvent({
      toolName: "powershell",
      toolCallId: "c",
      isError: true,
      result: { content: [{ type: "text", text: "denied" }] },
    })?.kind,
    "verification",
  );
});

test("当前交接失败不能引用上次成功背书，回执可从快照重放", () => {
  const task = newTask(
    "00000000-0000-4000-8000-000000000001",
    {
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    "now",
  );
  task.events = [
    { seq: 1, at: "now", role: "lead", kind: "handoff", text: "first" },
    { seq: 2, at: "now", role: "sidekick", kind: "verification", text: "old-success" },
    { seq: 3, at: "now", role: "lead", kind: "handoff", text: "second" },
    { seq: 4, at: "now", role: "sidekick", kind: "verification", text: "new-failure" },
  ];
  const restored = parseTask(JSON.parse(JSON.stringify(task)));
  const report = verificationReport(restored);
  assert.match(report, /new-failure/);
  assert(!report.includes("old-success"));
});
