import type { TwoCodeTask } from "@zcode/services";
import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";

export function projectTwoCodeUsage(task: TwoCodeTask | undefined): SessionUsageState | null {
  const receipts = task?.usage ?? [];
  if (!task || !receipts.length) return null;
  const cumulative = receipts.reduce(
    (sum, u) => ({
      inputTokens: sum.inputTokens + u.inputTokens,
      outputTokens: sum.outputTokens + u.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + u.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + u.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  const timed = receipts.filter((u) => u.modelMs !== null && u.modelMs > 0);
  const modelMs = timed.length ? timed.reduce((sum, u) => sum + u.modelMs!, 0) : null;
  const ttft = receipts.filter((u) => u.ttftMs !== null);
  return {
    cumulative,
    contextWindow: null,
    statistics: {
      turns: task.events.filter((e) => e.role === "user" && e.kind === "message").length,
      steps: receipts.reduce((sum, u) => sum + u.steps, 0),
      toolCalls: task.events.filter((e) => e.kind === "tool").length,
      timedSteps: timed.reduce((sum, u) => sum + u.steps, 0),
      modelMs,
      toolMs: receipts.every((u) => u.toolMs !== null)
        ? receipts.reduce((sum, u) => sum + u.toolMs!, 0)
        : null,
      averageTtftMs: ttft.length ? ttft.reduce((sum, u) => sum + u.ttftMs!, 0) / ttft.length : null,
      tokensPerSecond: modelMs
        ? (timed.reduce((sum, u) => sum + u.outputTokens, 0) * 1000) / modelMs
        : null,
    },
  };
}
