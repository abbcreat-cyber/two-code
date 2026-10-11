import type { EngineEvent } from "../app/ports.js";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
interface Draft {
  name: string;
  characters: number;
  bytes: number;
  preview?: string;
  sent: number;
  at: number;
}
/** 原生工具参数流不是思考或执行；有限合并可见草稿，避免每个token广播整份任务。 */
export class NativeToolProgress {
  private drafts = new Map<string, Draft>();
  private claudeIds = new Map<number, string>();
  private piIds = new Map<number, string>();
  private start(id: string, name: string, now: number) {
    if (!id || !name || this.drafts.has(id)) return;
    this.drafts.set(id, {
      name,
      characters: 0,
      bytes: 0,
      sent: 0,
      at: now,
      ...(/^(write_file|edit_file|write|edit)$/i.test(name) ? { preview: "" } : {}),
    });
    return this.flush(id, now);
  }
  private flush(id: string, now: number): EngineEvent | undefined {
    const d = this.drafts.get(id);
    if (!d) return;
    d.sent = d.characters;
    d.at = now;
    return {
      kind: "tool_input",
      toolCallId: id,
      text: JSON.stringify({
        tool: d.name,
        characters: d.characters,
        bytes: d.bytes,
        preview: d.preview,
        truncated: d.preview !== undefined && d.characters > 20000,
      }),
    };
  }
  private append(id: string, text: string, now: number) {
    const d = this.drafts.get(id);
    if (!d || !text) return;
    d.characters += text.length;
    d.bytes += Buffer.byteLength(text);
    if (d.preview !== undefined) d.preview = (d.preview + text).slice(0, 20000);
    if (d.characters - d.sent >= 512 || now - d.at >= 250) return this.flush(id, now);
  }
  pi(record: Record<string, unknown>, now = Date.now()): EngineEvent | undefined {
    if (record.type === "message_start" && obj(record.message).role === "assistant")
      this.piIds.clear();
    if (record.type === "tool_execution_end") {
      const id = String(record.toolCallId ?? "");
      if (!this.drafts.delete(id)) return;
      return { kind: "tool_end", toolCallId: id, text: record.isError ? "error" : "success" };
    }
    if (record.type !== "message_update") return;
    const d = obj(record.assistantMessageEvent);
    const content = obj(d.partial).content;
    const call = obj(
      d.toolCall ?? (Array.isArray(content) ? content[Number(d.contentIndex)] : undefined),
    );
    // Step RPC精简事件只在start携带ID/name，后续按contentIndex关联；Pi仍可提供partial。
    const index = Number(d.contentIndex),
      id = String(d.id ?? call.id ?? this.piIds.get(index) ?? "");
    if (d.type === "toolcall_start") {
      this.piIds.set(index, id);
      return this.start(id, String(d.toolName ?? call.name ?? ""), now);
    }
    if (d.type === "toolcall_delta") return this.append(id, String(d.delta ?? ""), now);
    if (d.type === "toolcall_end") return this.flush(id, now);
  }
  claude(event: unknown, now = Date.now()): EngineEvent | undefined {
    const e = obj(event),
      delta = obj(e.delta),
      index = Number(e.index);
    if (e.type === "message_start") this.claudeIds.clear();
    if (e.type === "content_block_start" && obj(e.content_block).type === "tool_use") {
      const block = obj(e.content_block),
        id = String(block.id);
      this.claudeIds.set(index, id);
      return this.start(id, String(block.name), now);
    }
    const id = this.claudeIds.get(index);
    if (!id) return;
    if (e.type === "content_block_delta" && delta.type === "input_json_delta")
      return this.append(id, String(delta.partial_json ?? ""), now);
    if (e.type === "content_block_stop") {
      this.claudeIds.delete(index);
      const result = this.flush(id, now);
      this.drafts.delete(id);
      return result;
    }
  }
}
