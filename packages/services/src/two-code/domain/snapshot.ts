import { z } from "zod";
import type { TwoCodePreferences, TwoCodeTask } from "../contract.js";
const status = z.enum(["idle", "running", "completed", "cancelled", "error"]);
const role = z.enum(["lead", "sidekick"]);
const mode = z.enum(["plan", "build", "edit", "yolo"]).default("build");
const selection = z.object({
  harness: z.enum(["zcode", "claude-code", "pi", "step-code"]),
  provider: z.string().max(300).optional(),
  model: z.string().max(300).optional(),
  modelLabel: z.string().max(300).optional(),
  thinking: z.string().max(300).optional(),
});
export function parsePreferences(value: unknown): TwoCodePreferences {
  return z.object({ dual: z.boolean(), lead: selection, sidekick: selection, mode }).parse(value);
}
const actor = z.object({
  availableTools: z.array(z.string()).optional(),
  selection,
  status,
  sessionId: z.string().optional(),
  actualModel: z.string().optional(),
  lastReport: z.string().optional(),
});
const schema = z.object({
  mode,
  usage: z
    .array(
      z.object({
        id: z.string(),
        role,
        inputTokens: z.number().nonnegative().finite(),
        outputTokens: z.number().nonnegative().finite(),
        cacheReadTokens: z.number().nonnegative().finite(),
        cacheWriteTokens: z.number().nonnegative().finite(),
        steps: z.number().int().nonnegative(),
        modelMs: z.number().nonnegative().finite().nullable(),
        toolMs: z.number().nonnegative().finite().nullable(),
        ttftMs: z.number().nonnegative().finite().nullable(),
      }),
    )
    .default([]),
  id: z.uuid(),
  workspacePath: z.string().min(1),
  title: z.string(),
  dual: z.boolean(),
  status,
  lead: actor,
  sidekick: actor,
  updatedAt: z.string(),
  error: z.string().optional(),
  requestIds: z.array(z.string()),
  permissions: z.array(z.object({ id: z.string(), role, title: z.string(), detail: z.string() })),
  events: z.array(
    z.object({
      seq: z.number().int().positive(),
      at: z.string(),
      role: z.enum(["lead", "sidekick", "user", "system"]),
      kind: z.enum([
        "message",
        "reasoning",
        "tool",
        "status",
        "error",
        "handoff",
        "handoff_update",
        "handoff_report",
      ]),
      text: z.string(),
      toolCallId: z.string().optional(),
      notExecuted: z.boolean().optional(),
      continuation: z.boolean().optional(),
      handoffUserSeq: z.number().int().positive().optional(),
      requestId: z.string().optional(),
      deliveryFailed: z.boolean().optional(),
    }),
  ),
});
export function parseTask(value: unknown): TwoCodeTask {
  const task = schema.parse(value);
  if (task.events.some((event, i) => i > 0 && event.seq <= task.events[i - 1]!.seq))
    throw new Error("任务事件序号无效，保留原文件");
  return task;
}
