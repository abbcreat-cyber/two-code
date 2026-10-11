import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

export interface LedgerRow {
  phase: string;
  passed: boolean;
  error: string;
  hash: string;
  at: string;
}
export async function readLedger(cwd: string): Promise<LedgerRow[]> {
  const text = await fs.readFile(`${cwd}/.qa/ledger.jsonl`, "utf8").catch((e) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
export function stageMetrics(task: TwoCodeTask, seq: number, ledger: LedgerRow[]) {
  const events = task.events.filter((e) => e.seq > seq);
  const calls = new Set(
    events
      .filter((e) => e.kind === "tool" && e.toolCallId && !e.notExecuted)
      .map((e) => `${e.role}:${e.toolCallId}`),
  );
  const denied = new Set(
    events.filter((e) => e.notExecuted && e.toolCallId).map((e) => `${e.role}:${e.toolCallId}`),
  );
  const commandReceipts = events
    .filter((e) => e.role === "sidekick" && e.kind === "verification")
    .map((e) => JSON.parse(e.text))
    .filter((r) => r.status !== "not-executed");
  // 完全访问下还可能有列目录等普通命令，不能把所有shell回执当成固定测试次数。
  const receipts = commandReceipts.filter((r) =>
    r.summaries?.some((s: string) =>
      /^PASS: (all|core|storage|expiry) coding checks$|^FAIL: /u.test(s),
    ),
  );
  const handoffs = events.filter((e) => e.kind === "handoff").length;
  const reports = events.filter((e) => e.kind === "handoff_report").length;
  const issues: string[] = [];
  if (!handoffs || !reports) issues.push("缺少副手交接或报告");
  if (handoffs !== reports) issues.push("交接和报告次数不一致");
  if (receipts.length !== ledger.length) issues.push("已执行回执与真实测试账本次数不一致");
  const leadWriteCalls = events.filter(
    (e) =>
      e.role === "lead" &&
      e.kind === "tool" &&
      !e.notExecuted &&
      /^(write|edit|write_file|edit_file|apply_patch|multiedit|notebookedit)$/i.test(e.text),
  ).length;
  if (leadWriteCalls) issues.push("主手直接写入或修改了文件，偏离指定分工");
  return {
    firstCheckPassed: ledger[0]?.passed === true,
    validationRuns: ledger.length,
    failedChecks: ledger.filter((r) => !r.passed).length,
    repeatedPassingChecks: ledger.filter(
      (r, i) =>
        i > 0 &&
        r.passed &&
        ledger[i - 1].passed &&
        r.hash === ledger[i - 1].hash &&
        r.phase === ledger[i - 1].phase,
    ).length,
    handoffs,
    reports,
    leadWriteCalls,
    toolCalls: [...calls].filter((id) => !denied.has(id)).length,
    notExecutedCalls: denied.size,
    toolErrors: events.filter((e) => e.kind === "tool_end" && e.text === "error").length,
    errors: events.filter((e) => e.kind === "error").map((e) => ({ role: e.role, text: e.text })),
    receipts,
    otherCommandReceipts: commandReceipts.length - receipts.length,
    issues,
  };
}
export async function nativeModels(task: TwoCodeTask) {
  const result: Record<string, unknown> = {};
  for (const role of ["lead", "sidekick"] as const) {
    const actor = task[role];
    if (!actor.sessionId) continue;
    const file =
      actor.selection.harness === "claude-code"
        ? path.join(
            homedir(),
            ".claude/projects",
            task.workspacePath.replace(/[^a-zA-Z0-9]/g, "-"),
            `${actor.sessionId}.jsonl`,
          )
        : actor.sessionId;
    const rows = (await fs.readFile(file, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((s) => JSON.parse(s));
    const models = [
      ...new Set(
        rows
          .map((r) => r.message?.model ?? (r.type === "model_change" ? r.modelId : undefined))
          .filter((m) => m && m !== "<synthetic>"),
      ),
    ];
    const calls = new Map<string, { name: string; command?: string }>();
    const toolFailures: unknown[] = [];
    for (const row of rows) {
      const message = row.message;
      for (const b of Array.isArray(message?.content) ? message.content : []) {
        if (["tool_use", "toolCall"].includes(b.type))
          calls.set(b.id, { name: b.name, command: (b.input ?? b.arguments)?.command });
        if (b.type === "tool_result" && b.is_error)
          toolFailures.push({
            ...calls.get(b.tool_use_id),
            output: JSON.stringify(b.content).slice(0, 900),
          });
      }
      if (message?.role === "toolResult" && message.isError)
        toolFailures.push({
          ...calls.get(message.toolCallId),
          name: message.toolName,
          output: JSON.stringify(message.content).slice(0, 900),
        });
    }
    result[role] = {
      selection: actor.selection,
      actualModel: actor.actualModel,
      models,
      toolFailures,
      sessionId: actor.sessionId,
    };
  }
  return result;
}
export async function artifacts(cwd: string) {
  const names = await fs.readdir(`${cwd}/src`).catch(() => []);
  const result: Record<string, string> = {};
  for (const name of names.filter((n) => n.endsWith(".mjs")))
    result[`src/${name}`] = await fs.readFile(`${cwd}/src/${name}`, "utf8");
  try {
    result["README.md"] = await fs.readFile(`${cwd}/README.md`, "utf8");
  } catch {}
  return result;
}
