import type { EngineEvent } from "../app/ports.js";

/** 仅处理工具执行前门禁的明确拒绝；执行报错和中断不能推导为未执行。 */
export function rejectedToolEvent(
  record: Record<string, unknown>,
): { event: EngineEvent; stopped: boolean } | undefined {
  if (!record.isError) return;
  const value = record.result;
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "content" in value && Array.isArray(value.content)
        ? value.content
            .filter((p) => p?.type === "text")
            .map((p) => String(p.text ?? ""))
            .join("")
        : "";
  const permission = text.startsWith("[two-code-permission-denied]");
  if (!permission && !/\[desktop-opening-(required|stopped)\]/.test(text)) return;
  const stopped = !permission && text.includes("[desktop-opening-stopped]");
  return {
    stopped,
    event: {
      kind: "tool",
      toolCallId: String(record.toolCallId),
      notExecuted: true,
      text: permission
        ? "未执行：本次操作未获批准"
        : stopped
          ? "工具未执行：缺少开场说明，本轮已停止。"
          : "工具尚未执行，等待补充开场说明。",
    },
  };
}
