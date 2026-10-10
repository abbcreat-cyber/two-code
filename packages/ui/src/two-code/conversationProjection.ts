import type { TwoCodeTask } from "@zcode/services";
import type { ConversationRow, ToolCallRow, TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";

/** 仅作展示投影：复用原生行和滚动/Markdown渲染，不复制执行状态。 */
export function projectTwoCodeRows(task?: TwoCodeTask): ConversationRow[] {
  if (!task) return [];
  const rows: ConversationRow[] = [];
  let turnId = "",
    header: TurnHeaderRow | undefined,
    handoff: ToolCallRow | undefined;
  let message: Extract<ConversationRow, { kind: "assistantText" }> | undefined;
  let thought: Extract<ConversationRow, { kind: "reasoning" }> | undefined;
  let thoughtRole: string | undefined;
  for (const event of task.events) {
    const at = Date.parse(event.at),
      rowId = event.seq * 10;
    const base = () => ({ rowId, turnId, createdAt: at, createdAtSeq: event.seq });
    if (thought && (event.kind !== "reasoning" || event.role !== thoughtRole || !event.text)) {
      thought.state =
        (event.kind === "error" || event.kind === "status") &&
        (task.status === "cancelled" || task.status === "error")
          ? "interrupted"
          : "complete";
      thought.durationMs = Math.max(0, at - thought.createdAt);
      thought = undefined;
    }
    // 直接投影原生reasoning行，让原有“已工作”和思考显示设置拥有折叠交互。
    if (event.kind === "reasoning") {
      if (!event.text) continue;
      message = undefined;
      if (thought) thought.text += event.text;
      else {
        thoughtRole = event.role;
        thought = {
          ...base(),
          kind: "reasoning",
          state: "streaming",
          text: `${event.role === "sidekick" ? "**副手**" : "**主手**"}\n\n${event.text}`,
        };
        rows.push(thought);
      }
      continue;
    }
    if (event.role === "user" && event.kind === "message") {
      if (header?.state === "running") {
        header.state = "completedSuccess";
        header.endedAt = at;
      }
      turnId = `two-code-turn:${event.seq}`;
      header = {
        ...base(),
        kind: "turnHeader",
        origin: "userInput",
        state: "running",
        startedAt: at,
      };
      rows.push(header, {
        ...base(),
        rowId: rowId + 1,
        kind: "userInput",
        origin: "realUser",
        text: event.text,
      });
      message = undefined;
      handoff = undefined;
    } else if (event.kind === "handoff") {
      message = undefined;
      handoff = {
        ...base(),
        kind: "toolCall",
        toolCallId: `sidekick:${event.seq}`,
        toolName: "sidekick",
        status: "running",
        inputText: event.text,
        input: { description: `副手 · ${task.sidekick.selection.harness}`, task: event.text },
        output: { text: "" },
      };
      rows.push(handoff);
    } else if (event.role === "sidekick" && handoff) {
      if (event.kind === "message") handoff.output!.text += event.text;
      if (event.kind === "tool") handoff.output!.text += `\n调用工具：${event.text}\n`;
      if (event.kind === "status" && event.text.startsWith("执行已结束")) {
        handoff.status = "success";
        handoff.endedAt = at;
      }
    } else if (event.role === "lead" && event.kind === "message") {
      if (message) message.text += event.text;
      else {
        message = {
          ...base(),
          kind: "assistantText",
          text: event.text,
          state: "complete",
          model: task.lead.selection.modelLabel ?? task.lead.selection.model,
        };
        rows.push(message);
      }
    } else if (event.kind === "tool") {
      message = undefined;
      if (!/sidekick/.test(event.text))
        rows.push({
          ...base(),
          kind: "timelineMarker",
          lane: "assistantWork",
          marker: { type: "harnessActivity", label: `调用工具 · ${event.text}` },
        });
    } else if (event.kind === "error" && header) {
      header.state = task.status === "cancelled" ? "completedInterrupted" : "failed";
    }
  }
  if (header) {
    header.state =
      task.status === "running"
        ? "running"
        : task.status === "error"
          ? "failed"
          : task.status === "cancelled"
            ? "completedInterrupted"
            : "completedSuccess";
    // 配置保存也会更新updatedAt；已工作时长取最后执行事件，不能随切模型增长。
    if (task.status !== "running")
      header.endedAt = Date.parse(task.events.at(-1)?.at ?? task.updatedAt);
  }
  if (message && task.status === "running" && task.lead.status === "running")
    message.state = "streaming";
  if (thought && task.status !== "running")
    thought.state =
      task.status === "cancelled" || task.status === "error" ? "interrupted" : "complete";
  if (handoff?.status === "running" && task.status !== "running")
    handoff.status = task.sidekick.status === "completed" ? "success" : "cancelled";
  return rows;
}
