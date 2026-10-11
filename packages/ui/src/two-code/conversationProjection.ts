import type { TwoCodeTask } from "@zcode/services";
import type { ConversationRow, ToolCallRow, TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";

/** 仅作展示投影：复用原生行和滚动/Markdown渲染，不复制执行状态。 */
export function projectTwoCodeRows(task?: TwoCodeTask): ConversationRow[] {
  if (!task) return [];
  const rows: ConversationRow[] = [];
  const toolActivities = new Map<string, Extract<ConversationRow, { kind: "timelineMarker" }>>();
  let turnId = "",
    header: TurnHeaderRow | undefined,
    handoff: ToolCallRow | undefined;
  let message: Extract<ConversationRow, { kind: "assistantText" }> | undefined;
  let thought: Extract<ConversationRow, { kind: "reasoning" }> | undefined;
  let thoughtRole: string | undefined;
  let lastEventAt: number | undefined,
    interruptedTurn = false;
  for (const event of task.events) {
    const at = Date.parse(event.at),
      rowId = event.seq * 10;
    const previousAt = lastEventAt ?? at;
    lastEventAt = at;
    const stopping =
      event.role === "system" && event.kind === "status" && event.text === "正在停止主手与副手";
    if (stopping) interruptedTurn = true;
    const base = () => ({ rowId, turnId, createdAt: at, createdAtSeq: event.seq });
    if (thought && (event.kind !== "reasoning" || event.role !== thoughtRole || !event.text)) {
      thought.state = event.kind === "error" || stopping ? "interrupted" : "complete";
      thought.durationMs = Math.max(0, at - thought.createdAt);
      thought = undefined;
    }
    // 历史终态属于当轮事件；后续成功的任务快照不能改写之前的停止和副手状态。
    if (header && (stopping || event.kind === "error")) {
      header.state = interruptedTurn ? "completedInterrupted" : "failed";
      header.endedAt ??= at;
      if (handoff?.status === "running") {
        handoff.status = interruptedTurn ? "cancelled" : "error";
        handoff.endedAt = at;
        if (!interruptedTurn) handoff.error = { code: "two-code-run-failed", message: event.text };
      }
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
      if (event.continuation && header) {
        rows.push({
          ...base(),
          rowId: rowId + 1,
          kind: "userInput",
          origin: "realUser",
          text: event.text,
        });
        message = undefined;
        continue;
      }
      toolActivities.clear();
      if (header?.state === "running") {
        header.state = "completedSuccess";
        // 兼容没有结束标记的旧数据，也只能取上一条活动时间，不能计入聊天间隔。
        header.endedAt = previousAt;
      }
      if (handoff?.status === "running") {
        handoff.status = "cancelled";
        handoff.endedAt = header?.endedAt ?? previousAt;
      }
      interruptedTurn = false;
      turnId = `two-code:${task.id}:turn:${event.seq}`;
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
        toolCallId: `two-code:${task.id}:sidekick:${event.seq}`,
        toolName: "sidekick",
        status: "running",
        inputText: event.text,
        input: { description: `副手 · ${task.sidekick.selection.harness}`, task: event.text },
        output: { text: "" },
      };
      rows.push(handoff);
    } else if (event.kind === "handoff_update" && handoff) {
      handoff.inputText += `\n\n<lead_update>\n${event.text}\n</lead_update>`;
      handoff.input = {
        description: `副手 · ${task.sidekick.selection.harness}`,
        task: handoff.inputText,
      };
      message = undefined;
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
      const previous = event.toolCallId ? toolActivities.get(event.toolCallId) : undefined;
      if (event.notExecuted && previous?.marker.type === "harnessActivity") {
        previous.marker.label = `${previous.marker.label.replace(/^调用工具 · /, "")} · ${event.text}`;
        continue;
      }
      if (!/sidekick/.test(event.text)) {
        const activity: Extract<ConversationRow, { kind: "timelineMarker" }> = {
          ...base(),
          kind: "timelineMarker",
          lane: "assistantWork",
          marker: {
            type: "harnessActivity",
            label: event.notExecuted ? event.text : `调用工具 · ${event.text}`,
          },
        };
        rows.push(activity);
        if (event.toolCallId) toolActivities.set(event.toolCallId, activity);
      }
    } else if (
      event.role === "lead" &&
      event.kind === "status" &&
      event.text.startsWith("执行已结束") &&
      header
    ) {
      header.state = "completedSuccess";
      header.endedAt = at;
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
      header.endedAt ??= Date.parse(task.events.at(-1)?.at ?? task.updatedAt);
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
