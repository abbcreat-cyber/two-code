import {
  applyConversationDeltas,
  type ConversationSnapshot,
  type ConversationTopicFrame,
  type PendingInteraction,
} from "@zcode/shared/zcode-protocol-v4";
import type { EngineEvent } from "../app/ports.js";
import { verificationEvent } from "./verification-receipts.js";

/** V4是原生事实源；按本轮commandId关联，不把历史终态/重放当新回答。 */
export class ZCodeProjection {
  snapshot?: ConversationSnapshot;
  private armed = false;
  private settled = false;
  private model = "";
  private text = new Map<number, string>();
  private tools = new Map<
    string,
    { started: boolean; ended: boolean; characters: number; at: number }
  >();
  private interactions = new Set<string>();
  private denied = new Set<string>();
  constructor(private readonly commandId: string) {}
  arm() {
    this.armed = true;
  }
  deny(toolCallId: string) {
    this.denied.add(toolCallId);
  }
  accept(
    frame: ConversationTopicFrame,
    now = Date.now(),
  ): {
    events: EngineEvent[];
    interactions: PendingInteraction[];
    completed?: string;
    error?: Error;
  } {
    const events: EngineEvent[] = [],
      interactions: PendingInteraction[] = [];
    if (frame.payload.kind === "snapshot") {
      if (
        this.snapshot &&
        frame.payload.snapshot.logEpoch === this.snapshot.logEpoch &&
        frame.toSeq <= this.snapshot.seq
      )
        return { events, interactions };
      this.snapshot = frame.payload.snapshot;
    } else {
      if (this.snapshot && frame.toSeq <= this.snapshot.seq) return { events, interactions };
      if (!this.snapshot || frame.fromSeq !== this.snapshot.seq)
        throw Error("ZCode V4事件序列不连续，已停止本轮以避免错误拼接");
      this.snapshot = {
        ...applyConversationDeltas(this.snapshot, frame.payload.deltas),
        seq: frame.toSeq,
      };
    }
    if (!this.armed || this.settled) return { events, interactions };
    const snapshot = this.snapshot;
    for (const request of snapshot.pendingInteractions) {
      if (!this.interactions.has(request.interactionId)) {
        this.interactions.add(request.interactionId);
        interactions.push(request);
      }
    }
    const header = snapshot.rows.window.find(
      (r) => r.kind === "turnHeader" && r.sourceCommandId === this.commandId,
    );
    if (!header || header.kind !== "turnHeader") return { events, interactions };
    if (this.model !== snapshot.config.model) {
      this.model = snapshot.config.model;
      events.push({ kind: "model", text: this.model });
    }
    const rows = snapshot.rows.window.filter(
      (r) => (r.productTurnId ?? r.turnId) === (header.productTurnId ?? header.turnId),
    );
    for (const row of rows) {
      if (row.kind === "assistantText" || row.kind === "reasoning") {
        const previous = this.text.get(row.rowId) ?? "";
        if (!row.text.startsWith(previous))
          throw Error("ZCode本轮流式正文被非追加改写，不能静默拼接");
        if (row.text.length > previous.length)
          events.push({
            kind: row.kind === "assistantText" ? "message" : "reasoning",
            blockId: `zcode:${this.commandId}:${row.rowId}`,
            text: row.text.slice(previous.length),
          });
        this.text.set(row.rowId, row.text);
      } else if (row.kind === "toolCall") {
        let tool = this.tools.get(row.toolCallId);
        if (!tool) {
          tool = { started: false, ended: false, characters: -1, at: 0 };
          this.tools.set(row.toolCallId, tool);
        }
        const terminal = ["success", "error", "cancelled"].includes(row.status);
        if (
          row.inputText.length !== tool.characters &&
          (tool.characters < 0 ||
            row.inputText.length - tool.characters >= 512 ||
            now - tool.at >= 250 ||
            terminal)
        ) {
          tool.characters = row.inputText.length;
          tool.at = now;
          const preview = /^(write|edit|write_file|edit_file)$/i.test(row.toolName)
            ? row.inputText.slice(0, 20000)
            : undefined;
          events.push({
            kind: "tool_input",
            toolCallId: row.toolCallId,
            text: JSON.stringify({
              tool: row.toolName,
              characters: row.inputText.length,
              bytes: Buffer.byteLength(row.inputText),
              preview,
              truncated: preview !== undefined && row.inputText.length > 20000,
            }),
          });
        }
        if (!tool.started && (row.status === "running" || terminal)) {
          tool.started = true;
          const notExecuted = this.denied.has(row.toolCallId);
          events.push({
            kind: "tool",
            toolCallId: row.toolCallId,
            text: row.toolName,
            ...(notExecuted ? { notExecuted: true } : {}),
          });
        }
        if (terminal && !tool.ended) {
          tool.ended = true;
          const notExecuted = this.denied.has(row.toolCallId),
            interrupted = row.status === "cancelled";
          events.push({
            kind: "tool_end",
            toolCallId: row.toolCallId,
            text: notExecuted
              ? "not-executed"
              : interrupted
                ? "interrupted"
                : row.status === "error"
                  ? "error"
                  : "success",
            ...(notExecuted ? { notExecuted: true } : {}),
          });
          const receipt = verificationEvent(
            row.toolName,
            row.toolCallId,
            row.output?.text ?? row.error?.message ?? "",
            row.status === "error",
            interrupted,
            notExecuted,
          );
          if (receipt) events.push(receipt);
        }
      }
    }
    if (header.state === "failed" || header.state === "completedInterrupted") {
      this.settled = true;
      return {
        events,
        interactions,
        error: Error(
          header.state === "completedInterrupted"
            ? "ZCode任务已停止"
            : (snapshot.control.lastError?.message ?? "ZCode原生执行失败"),
        ),
      };
    }
    if (header.state === "completedSuccess") {
      this.settled = true;
      const texts = rows.filter((r) => r.kind === "assistantText"),
        last = texts.at(-1);
      const final = last?.assistantResponseId
        ? texts.filter((r) => r.assistantResponseId === last.assistantResponseId)
        : last
          ? [last]
          : [];
      return { events, interactions, completed: final.map((r) => r.text).join("") };
    }
    return { events, interactions };
  }
}
