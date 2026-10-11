import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EngineEvent } from "../app/ports.js";

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
): EngineEvent | undefined {
  if (!["powershell", "bash", "run_command", "execute_command"].includes(tool.toLowerCase()))
    return;
  const text = textOf(result),
    match = /(?:^|\n)\s*(?:EXIT(?:CODE)?|Exit code)\s*[:=]\s*(-?\d+)\s*(?:$|\n)/i.exec(text);
  const exitCode = match ? Number(match[1]) : undefined;
  const summaries = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length <= 180 &&
        !/(?:api[_ -]?key|token|secret|password|authorization)\s*[:=]/i.test(s) &&
        /^(?:\d+\s+(?:tests?|checks?)\s+(?:passed|failed)\b|(?:PASS|FAIL|OK)\b|Tests?:\s|[✔✖ℹ]\s|EXIT(?:CODE)?\s*[:=]|(?:测试|检查|校验).*(?:通过|失败))/i.test(
          s,
        ),
    )
    .slice(-8);
  return {
    kind: "verification",
    toolCallId: id,
    text: JSON.stringify({
      tool,
      status: interrupted ? "interrupted" : isError ? "failed" : "completed",
      ...(exitCode !== undefined ? { reportedExitCode: exitCode } : {}),
      summaries,
    }),
  };
}
export function nativeVerificationEvent(record: Record<string, unknown>): EngineEvent | undefined {
  return verificationEvent(
    String(record.toolName ?? ""),
    String(record.toolCallId ?? ""),
    record.result,
    record.isError === true,
  );
}
/** SDK助手的tool_use和原生user.tool_result配对；不依赖副手最终总结。 */
export class ClaudeReceiptTracker {
  private names = new Map<string, string>();
  private done = new Set<string>();
  constructor(private emit: (event: EngineEvent) => Promise<void>) {}
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
          await this.emit({
            kind: "tool_end",
            toolCallId: b.tool_use_id,
            text: b.is_error ? "error" : "success",
          });
          const event = verificationEvent(
            this.names.get(b.tool_use_id) ?? "",
            b.tool_use_id,
            b.content,
            b.is_error === true,
            object(message.tool_use_result).interrupted === true,
          );
          if (event) await this.emit(event);
        }
  }
}
