import type { EngineEvent } from "../app/ports.js";

/** 传递原生块身份；thinking尾包和text首包可交错到达，不能按到达顺序猜分段。 */
export function nativeDeltaEvent(
  delta: Record<string, unknown>,
  responseId: string,
): EngineEvent | undefined {
  const blockId = `${responseId}:${delta.contentIndex ?? 0}`;
  if (delta.type === "text_delta")
    return { kind: "message", text: String(delta.delta ?? ""), blockId };
  if (delta.type === "thinking_delta" || delta.type === "thinking_end")
    return {
      kind: "reasoning",
      text: delta.type === "thinking_end" ? "" : String(delta.delta ?? ""),
      blockId,
    };
}
