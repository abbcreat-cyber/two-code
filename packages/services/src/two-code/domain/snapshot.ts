import { z } from "zod";
import type { TwoCodePreferences, TwoCodeTask } from "../contract.js";
const status = z.enum(["idle", "running", "completed", "cancelled", "error"]);
const role = z.enum(["lead", "sidekick"]);
const selection = z.object({
  harness: z.enum(["zcode", "claude-code", "pi"]),
  provider: z.string().max(300).optional(),
  model: z.string().max(300).optional(),
  modelLabel: z.string().max(300).optional(),
  thinking: z.string().max(300).optional(),
});
export function parsePreferences(value: unknown): TwoCodePreferences {
  return z.object({ dual: z.boolean(), lead: selection, sidekick: selection }).parse(value);
}
const actor = z.object({
  selection,
  status,
  sessionId: z.string().optional(),
  actualModel: z.string().optional(),
  lastReport: z.string().optional(),
});
const schema = z.object({
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
      kind: z.enum(["message", "tool", "status", "error", "handoff"]),
      text: z.string(),
    }),
  ),
});
export function parseTask(value: unknown): TwoCodeTask {
  const task = schema.parse(value);
  if (task.events.some((event, i) => i > 0 && event.seq <= task.events[i - 1]!.seq))
    throw new Error("任务事件序号无效，保留原文件");
  return task;
}
