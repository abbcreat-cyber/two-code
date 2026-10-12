import { randomUUID } from "node:crypto";
import { Emitter } from "@zcode/rpc";
import type { ConversationDelta, ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import type { TwoCodeTask } from "../contract.js";
import type { TwoCodeViewFrame, TwoCodeViewSnapshot } from "../view-contract.js";
import { conversationSnapshot } from "../domain/conversation-snapshot.js";
import { projectTwoCodeRows } from "../domain/conversation-rows.js";

function metadata(task: TwoCodeTask): TwoCodeTask {
  return {
    ...task,
    events: task.events.filter(
      (e) =>
        e.role === "user" ||
        e.kind === "tool" ||
        e.kind === "status" ||
        e.kind === "error" ||
        e.deliveryFailed,
    ),
  };
}
function rowDeltas(
  previous: ConversationRow[],
  next: ConversationRow[],
): ConversationDelta[] | null {
  if (
    previous.length > next.length ||
    previous.some((row, index) => next[index]?.rowId !== row.rowId)
  )
    return null;
  const deltas: ConversationDelta[] = [];
  for (let index = 0; index < next.length; index++) {
    const row = next[index]!,
      old = previous[index];
    if (!old) {
      deltas.push({ op: "row.appended", row });
      continue;
    }
    if (
      row.kind === old.kind &&
      (row.kind === "reasoning" || row.kind === "assistantText") &&
      (old.kind === "reasoning" || old.kind === "assistantText")
    ) {
      const { text, ...rest } = row,
        { text: before, ...oldRest } = old;
      if (
        row.state === "streaming" &&
        old.state === "streaming" &&
        text.startsWith(before) &&
        JSON.stringify(rest) === JSON.stringify(oldRest)
      ) {
        if (text.length > before.length)
          deltas.push({
            op: "row.delta",
            rowId: row.rowId,
            path: "text",
            append: text.slice(before.length),
          });
        continue;
      }
    }
    if (JSON.stringify(row) !== JSON.stringify(old)) deltas.push({ op: "row.upserted", row });
  }
  return deltas;
}

/** Host 负责翻译标准行增量；不在 Renderer 重建任务历史，也不产生执行事实。 */
export class ConversationViews {
  private readonly epoch = randomUUID();
  private readonly changes = new Emitter<TwoCodeViewFrame>();
  private readonly states = new Map<string, { view: TwoCodeViewSnapshot; signature: string }>();
  readonly onDidChange = this.changes.event;

  update(task: TwoCodeTask): TwoCodeViewSnapshot {
    const previous = this.states.get(task.id);
    const rows = projectTwoCodeRows(task);
    const control = metadata(task);
    const signature = JSON.stringify({ ...control, updatedAt: "" });
    const deltas = previous ? rowDeltas(previous.view.snapshot.rows.window, rows) : null;
    if (previous && deltas?.length === 0 && previous.signature === signature) return previous.view;
    const revision = (previous?.view.snapshot.revision ?? 0) + 1;
    const view: TwoCodeViewSnapshot = {
      kind: "snapshot",
      task: structuredClone(control),
      snapshot: conversationSnapshot(task, rows, this.epoch, revision),
    };
    this.states.set(task.id, { view, signature });
    if (!previous || !deltas) this.changes.fire(structuredClone(view));
    else {
      const changed = previous.signature !== signature;
      if (changed)
        deltas.push({
          op: "state.updated",
          patch: {
            control: view.snapshot.control,
            inputRouting: view.snapshot.inputRouting,
            usage: view.snapshot.usage,
            config: view.snapshot.config,
            meta: view.snapshot.meta,
          },
        });
      this.changes.fire(
        structuredClone({
          kind: "delta",
          taskId: task.id,
          workspacePath: task.workspacePath,
          epoch: this.epoch,
          fromRevision: previous.view.snapshot.revision,
          revision,
          ...(changed ? { task: view.task } : {}),
          deltas,
        } satisfies TwoCodeViewFrame),
      );
    }
    return view;
  }
  snapshot(task: TwoCodeTask): TwoCodeViewSnapshot {
    return structuredClone(this.update(task));
  }
  dispose(): void {
    this.changes.dispose();
    this.states.clear();
  }
}
