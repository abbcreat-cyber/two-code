import type { TwoCodeTask } from "@zcode/services";
import { appendPromptHistoryEntry } from "../lib/promptHistory.js";
import { projectImageMessage } from "./imageMessage.js";

/** 从已有任务事实派生，不维护第二份发送账本；与原生输入历史一样仅回填文字。 */
export function twoCodePromptHistory(tasks: readonly TwoCodeTask[]): string[] {
  const prompts = tasks
    .flatMap((task) => {
      const failed = new Set(task.events.filter((e) => e.deliveryFailed).map((e) => e.requestId));
      return task.events.filter(
        (event) =>
          event.role === "user" &&
          event.kind === "message" &&
          !(event.requestId && failed.has(event.requestId)),
      );
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
  return prompts.reduce(
    (history, event) => appendPromptHistoryEntry(history, projectImageMessage(event.text).text),
    [] as string[],
  );
}
