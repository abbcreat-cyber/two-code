import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EngineEvent } from "../app/ports.js";
import { rejectedToolEvent } from "./tool-outcome.js";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const textOf = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v
          .filter((p) => p?.type === "text")
          .map((p) => String(p.text ?? ""))
          .join("\n")
      : textOf(object(v).content ?? "");
export function verificationEvent(
  tool: string,
  id: string,
  result: unknown,
  isError: boolean,
  interrupted = false,
  notExecuted = false,
): EngineEvent | undefined {
  if (!["powershell", "bash", "run_command", "execute_command"].includes(tool.toLowerCase()))
    return;
  const text = notExecuted ? "" : textOf(result),
    // Claude失败头和Step尾行格式不同；实测Step的Command exited with code被漏掉，
    // 只匹配独立的原生状态行，不能要求模型追加打印EXITCODE来补证。
    match =
      /(?:^|\n)[ \t]*(?:EXIT(?:CODE)?[ \t]*[:=][ \t]*|Exit code(?:[ \t]*[:=][ \t]*|[ \t]+)|Command exited with code[ \t]+)(-?\d+)[ \t]*(?:\r?$|\r?\n)/i.exec(
        text,
      );
  const exitCode = match ? Number(match[1]) : undefined;
  const summaries = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length <= 180 &&
        !/(?:api[_ -]?key|token|secret|password|authorization)\s*[:=]/i.test(s) &&
        /^(?:\d+\s+(?:tests?|checks?)\s+(?:passed|failed)\b|(?:PASS|FAIL|OK|WARN|WARNING|ERROR)\b|警告|错误|Tests?:\s|[✔✖ℹ]\s|EXIT(?:CODE)?\s*[:=]|(?:测试|检查|校验).*(?:通过|失败))/i.test(
          s,
        ),
    )
    .slice(-8);
  return {
    kind: "verification",
    toolCallId: id,
    text: JSON.stringify({
      tool,
      status: notExecuted
        ? "not-executed"
        : interrupted
          ? "interrupted"
          : isError
            ? "failed"
            : "completed",
      ...(Number.isSafeInteger(exitCode) ? { reportedExitCode: exitCode } : {}),
      summaries,
      outputCoverage: "selected-lines",
      streamSeparation: "unavailable",
    }),
  };
}
export function nativeVerificationEvent(record: Record<string, unknown>): EngineEvent | undefined {
  return verificationEvent(
    String(record.toolName ?? ""),
    String(record.toolCallId ?? ""),
    record.result,
    record.isError === true,
    false,
    rejectedToolEvent(record)?.event.notExecuted === true,
  );
}
/** SDK助手的tool_use和原生user.tool_result配对；不依赖副手最终总结。 */
export class ClaudeReceiptTracker {
  private names = new Map<string, string>();
  private done = new Set<string>();
  private deniedCalls = new Set<string>();
  private interruptCalls = new Set<string>();
  constructor(private emit: (event: EngineEvent) => Promise<void>) {}
  interruptRequested() {
    // 原生改向可能在interrupt应答前发回结果；只关联请求时尚未结束的调用。
    for (const id of this.names.keys()) if (!this.done.has(id)) this.interruptCalls.add(id);
  }
  /** 准入回调比SDK消息流更早到达也有效；只有明确拒绝才证明工具未执行。 */
  async denied(tool: string, id: string) {
    if (this.done.has(id) || this.deniedCalls.has(id)) return;
    this.deniedCalls.add(id);
    this.names.set(id, tool);
    await this.emit({
      kind: "tool",
      toolCallId: id,
      notExecuted: true,
      text: `${tool} · 未执行：本次操作未获批准`,
    });
  }
  async observe(message: SDKMessage) {
    if (message.type === "assistant")
      for (const b of message.message.content)
        if (b.type === "tool_use" && !this.names.has(b.id)) {
          this.names.set(b.id, b.name);
          await this.emit({ kind: "tool", text: b.name, toolCallId: b.id });
        }
    if (message.type === "user" && Array.isArray(message.message.content))
      for (const b of message.message.content)
        if (b.type === "tool_result" && !this.done.has(b.tool_use_id)) {
          this.done.add(b.tool_use_id);
          const notExecuted = this.deniedCalls.has(b.tool_use_id);
          const interrupted =
            object(message.tool_use_result).interrupted === true ||
            (this.interruptCalls.has(b.tool_use_id) &&
              b.is_error === true &&
              message.tool_use_result === "User rejected tool use");
          await this.emit({
            kind: "tool_end",
            toolCallId: b.tool_use_id,
            text: notExecuted
              ? "not-executed"
              : interrupted
                ? "interrupted"
                : b.is_error
                  ? "error"
                  : "success",
            ...(notExecuted ? { notExecuted: true } : {}),
          });
          const event = verificationEvent(
            this.names.get(b.tool_use_id) ?? "",
            b.tool_use_id,
            b.content,
            b.is_error === true,
            interrupted,
            notExecuted,
          );
          if (event) await this.emit(event);
        }
  }
}
