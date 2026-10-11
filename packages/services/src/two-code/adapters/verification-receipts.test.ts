import test from "node:test";
import assert from "node:assert/strict";
import {
  verificationEvent,
  nativeVerificationEvent,
  ClaudeReceiptTracker,
} from "./verification-receipts.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EngineEvent } from "../app/ports.js";

test("原生无冒号Exit code回执保留退出码，不靠模型额外打印EXITCODE", () => {
  for (const text of [
    "Exit code 7\nFAIL: fixture",
    "Exit code: 7\r\nFAIL: fixture",
    "EXITCODE=7",
    "EXIT: 7",
  ]) {
    assert.equal(
      JSON.parse(verificationEvent("PowerShell", "native", text, true)!.text).reportedExitCode,
      7,
    );
  }
  assert.equal(
    JSON.parse(verificationEvent("PowerShell", "native", "Exit code 7\nEXITCODE=0", true)!.text)
      .reportedExitCode,
    7,
  );
  for (const text of [
    "模型认为Exit code 7",
    "echo Exit code 7",
    "Exit code 7 trailing",
    "Exit code\n7",
    "Exit code 999999999999999999999",
  ]) {
    assert.equal(
      JSON.parse(verificationEvent("PowerShell", "native", text, true)!.text).reportedExitCode,
      undefined,
    );
  }
  assert.equal(
    JSON.parse(verificationEvent("PowerShell", "zero", "Exit code 0", false)!.text)
      .reportedExitCode,
    0,
  );
  const denied = JSON.parse(
    verificationEvent("PowerShell", "deny", "Exit code 7", true, false, true)!.text,
  );
  assert.equal(denied.reportedExitCode, undefined);
  assert.equal(denied.status, "not-executed");
});

test("SDK拒绝先于assistant到达时仍只产生未执行回执，普通错误不能伪装拒绝", async () => {
  const events: EngineEvent[] = [];
  const tracker = new ClaudeReceiptTracker(async (e) => {
    events.push(e);
  });
  await tracker.denied("PowerShell", "deny-id");
  await tracker.denied("PowerShell", "deny-id");
  const assistant = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "deny-id", name: "PowerShell" }] },
  } as SDKMessage;
  const result = {
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "deny-id", is_error: true, content: "Error: refused" },
      ],
    },
  } as SDKMessage;
  await tracker.observe(assistant);
  await tracker.observe(result);
  await tracker.observe(result);
  assert.equal(events.filter((e) => e.kind === "tool").length, 1);
  assert(events.find((e) => e.kind === "tool")!.notExecuted);
  assert.equal(events.find((e) => e.kind === "tool_end")!.text, "not-executed");
  const receipt = JSON.parse(events.find((e) => e.kind === "verification")!.text);
  assert.equal(receipt.status, "not-executed");
  assert(!("reportedExitCode" in receipt));
  assert.deepEqual(receipt.summaries, []);
  assert.equal(
    JSON.parse(verificationEvent("PowerShell", "other", "Error: refused", true)!.text).status,
    "failed",
  );
});
test("SDK已开始后中断与执行前拒绝不同", async () => {
  const events: EngineEvent[] = [];
  const tracker = new ClaudeReceiptTracker(async (e) => {
    events.push(e);
  });
  await tracker.observe({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "i", name: "PowerShell" }] },
  } as SDKMessage);
  await tracker.observe({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "i", is_error: true, content: "stopped" }],
    },
    tool_use_result: { interrupted: true },
  } as SDKMessage);
  assert.equal(events.find((e) => e.kind === "tool_end")!.text, "interrupted");
  assert(!events.some((e) => e.notExecuted));
  assert.equal(
    JSON.parse(events.find((e) => e.kind === "verification")!.text).status,
    "interrupted",
  );
});
test("Step执行前门禁拒绝不产生失败测试或退出码", () => {
  const event = nativeVerificationEvent({
    toolName: "powershell",
    toolCallId: "p",
    isError: true,
    result: "[two-code-permission-denied] denied\nEXITCODE=9",
  })!;
  const receipt = JSON.parse(event.text);
  assert.equal(receipt.status, "not-executed");
  assert(!("reportedExitCode" in receipt));
});
test("改向只关联当时未结束调用的原生拒绝标记，不污染普通错误与新调用", async () => {
  const events: EngineEvent[] = [];
  const tracker = new ClaudeReceiptTracker(async (e) => {
    events.push(e);
  });
  const start = (id: string) =>
    tracker.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name: "PowerShell" }] },
    } as SDKMessage);
  const end = (id: string, native: unknown, error = true) =>
    tracker.observe({
      type: "user",
      tool_use_result: native,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            is_error: error,
            content: "User rejected tool use",
          },
        ],
      },
    } as SDKMessage);
  await start("finished");
  await end("finished", "User rejected tool use");
  for (const id of ["interrupt", "failed", "success", "denied"]) await start(id);
  await tracker.denied("PowerShell", "denied");
  tracker.interruptRequested();
  await start("new");
  await end("interrupt", "User rejected tool use");
  await end("interrupt", "User rejected tool use");
  await end("failed", { error: "exit 7" });
  await end("success", "User rejected tool use", false);
  await end("denied", "User rejected tool use");
  await end("new", "User rejected tool use");
  assert.deepEqual(
    events
      .filter((e) => e.kind === "verification")
      .map((e) => [e.toolCallId, JSON.parse(e.text).status]),
    [
      ["finished", "failed"],
      ["interrupt", "interrupted"],
      ["failed", "failed"],
      ["success", "completed"],
      ["denied", "not-executed"],
      ["new", "failed"],
    ],
  );
});
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
  assert.equal(data.streamSeparation, "unavailable");
  assert.deepEqual(data.summaries, ["3 checks passed", "EXITCODE=0"]);
  assert(!event.text.includes("private"));
  const warning = verificationEvent(
    "PowerShell",
    "w",
    "3 checks passed\nWARN: optional notice\nWARNING api_key=private",
    false,
  )!;
  assert(JSON.parse(warning.text).summaries.includes("WARN: optional notice"));
  assert(!warning.text.includes("private"));
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
