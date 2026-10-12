import type { ConversationRow, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import type { TwoCodeTask } from "../task-types.js";

/** 标准只读会话快照；命令仍走 Coordinator，未接入的原生命令不得伪装可用。 */
export function conversationSnapshot(
  task: TwoCodeTask,
  rows: ConversationRow[],
  epoch: string,
  revision: number,
): ConversationSnapshot {
  const running = task.status === "running";
  const denied = { allowed: false as const, reasonCode: "two-code.command-not-routed" };
  return {
    protocolVersion: 1,
    sessionId: `two-code:${task.id}`,
    logEpoch: epoch,
    seq: revision,
    revision,
    control: {
      phase: running
        ? "running"
        : task.status === "cancelled"
          ? "completedInterrupted"
          : task.status === "error"
            ? "error"
            : task.status === "idle"
              ? "draft"
              : "completedSuccess",
      sessionEnded: !running && task.status !== "idle",
      canStop: running,
      stopState: running ? "stoppable" : "idle",
      stopTargetKind: "assistant",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: denied,
      compact: denied,
      switchModelConfig: denied,
      setFollowupMode: denied,
      queueEdit: denied,
      sendQueuedNow: denied,
      pauseGoal: denied,
      resumeGoal: denied,
    },
    inputRouting: { mode: running ? "guide" : "startNow" },
    meta: { title: task.title, titleSource: "custom" },
    config: {
      provider: task.lead.selection.provider ?? task.lead.selection.harness,
      model: task.lead.selection.model ?? "",
      thought: task.lead.selection.thinking ?? "",
      thoughtLevels: [],
      followupMode: "guide",
      mode: task.mode ?? "build",
    },
    usage: {
      contextWindow: null,
      cumulative: (task.usage ?? []).reduce(
        (sum, receipt) => ({
          inputTokens: sum.inputTokens + receipt.inputTokens,
          outputTokens: sum.outputTokens + receipt.outputTokens,
          cacheReadTokens: sum.cacheReadTokens + receipt.cacheReadTokens,
          cacheWriteTokens: sum.cacheWriteTokens + receipt.cacheWriteTokens,
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ),
    },
    modelTransition: null,
    queue: { items: [], autoDrain: false },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
  };
}
