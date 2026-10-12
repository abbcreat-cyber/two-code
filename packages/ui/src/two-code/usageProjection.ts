import type { TwoCodeTask } from "@zcode/services";
import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";

export function projectTwoCodeUsage(
  task: TwoCodeTask | undefined,
  role?: "lead" | "sidekick",
): SessionUsageState | null {
  const receipts = (task?.usage ?? []).filter((receipt) => !role || receipt.role === role);
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

export function projectTwoCodeRoleUsage(task: TwoCodeTask) {
  return (["lead", "sidekick"] as const).map((role) => {
    const usage = projectTwoCodeUsage(task, role);
    const invoked =
      task[role].status !== "idle" ||
      task.events.some((event) => event.role === role) ||
      !!task[role].sessionId;
    return {
      role,
      selection: task[role].selection,
      usage,
      state: usage
        ? ("reported" as const)
        : invoked
          ? ("unreported" as const)
          : ("not-invoked" as const),
    };
  });
}
