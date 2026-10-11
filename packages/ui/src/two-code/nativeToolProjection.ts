import type { TwoCodeTask } from "@zcode/services";
type TaskEvent = TwoCodeTask["events"][number];
import type { ConversationRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";

/** 展示直接派生原生调用ID和事件，不另建运行状态。副手草稿留在既有交接详情内。 */
export class NativeToolRows {
  private entries = new Map<string, { row: ToolCallRow; parent?: ToolCallRow; hidden?: boolean }>();
  handoff(turnId: string, rows: ConversationRow[]) {
    for (const entry of this.entries.values()) {
      if (entry.row.turnId !== turnId || entry.row.toolName !== "sidekick") continue;
      if (!["inputStreaming", "running"].includes(entry.row.status)) continue;
      entry.hidden = true;
      const index = rows.indexOf(entry.row);
      if (index >= 0) rows.splice(index, 1);
    }
  }
  apply(event: TaskEvent, turnId: string, rows: ConversationRow[], parent?: ToolCallRow): boolean {
    if (!event.toolCallId) return false;
    const key = `${turnId}:${event.role}:${event.toolCallId}`;
    let entry = this.entries.get(key);
    if (event.kind === "tool_input") {
      let draft: {
        tool: string;
        characters: number;
        bytes: number;
        preview?: string;
        truncated?: boolean;
      };
      try {
        draft = JSON.parse(event.text);
      } catch {
        return true;
      }
      if (!entry) {
        const row: ToolCallRow = {
          rowId: event.seq * 10,
          turnId,
          createdAt: Date.parse(event.at),
          createdAtSeq: event.seq,
          kind: "toolCall",
          toolCallId: `two-code:native:${key}`,
          toolName: draft.tool,
          status: "inputStreaming",
          inputText: "",
        };
        entry = { row, parent: event.role === "sidekick" ? parent : undefined };
        this.entries.set(key, entry);
        if (!entry.parent) rows.push(row);
      }
      if (entry.row.status !== "inputStreaming") return true;
      entry.row.inputText = draft.preview ?? "";
      entry.row.progress = {
        bytes: draft.bytes,
        updatedAt: Date.parse(event.at),
        previewLine: `正在生成${draft.preview !== undefined ? "文件内容" : "工具参数"} · ${draft.characters} 字符`,
      };
      entry.row.output = {
        text: `内容生成中，尚未开始执行。${draft.truncated ? "草稿仅显示前20000字符。" : ""}`,
      };
      return true;
    }
    if (!entry) return false;
    const { row } = entry;
    if (event.kind === "tool") {
      if (event.notExecuted) {
        row.status = "cancelled";
        row.output = { text: event.text };
      } else if (row.status === "inputStreaming") {
        row.status = "running";
        row.startedAt = Date.parse(event.at);
        row.output = { text: "原生工具正在处理。" };
      }
      row.progress = undefined;
      return !entry.parent;
    }
    if (event.kind === "tool_end") {
      if (row.status !== "cancelled") row.status = event.text === "success" ? "success" : "error";
      row.endedAt = Date.parse(event.at);
      row.progress = undefined;
      row.output = {
        text:
          row.status === "success"
            ? "原生工具已完成。"
            : row.status === "error"
              ? "原生工具返回失败。"
              : (row.output?.text ?? "未执行。"),
      };
      if (row.status === "error")
        row.error = { code: "native-tool-error", message: row.output.text };
      return true;
    }
    return false;
  }
  finish(task: TwoCodeTask, turnId: string) {
    for (const { row, parent, hidden } of this.entries.values()) {
      if (hidden) continue;
      if (!["inputStreaming", "running"].includes(row.status)) continue;
      if (task.status !== "running" || row.turnId !== turnId) {
        row.status = "cancelled";
        row.progress = undefined;
        row.output = { text: "已中断；未取得该工具的完成回执。" };
      } else if (parent) {
        parent.progress = row.progress;
        parent.output ??= { text: "" };
        parent.output.text += `\n${row.progress?.previewLine ?? `副手正在调用 ${row.toolName}`}\n${row.inputText ? `文件参数草稿（未完成）：\n${row.inputText}` : ""}`;
      }
    }
  }
}
