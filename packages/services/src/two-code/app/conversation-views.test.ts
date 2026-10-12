import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConversationDeltas,
  conversationSnapshotSchema,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { newTask, appendEvent } from "../domain/task.js";
import { projectTwoCodeRows } from "../domain/conversation-rows.js";
import { ConversationViews } from "./conversation-views.js";
import type { TaskEvent } from "../task-types.js";

test("native deltas preserve every rendered fact and retain unchanged row identity", () => {
  const task = newTask(
    "test",
    {
      workspacePath: "D:/qa",
      dual: true,
      lead: { harness: "claude-code" },
      sidekick: { harness: "step-code" },
    },
    new Date().toISOString(),
  );
  task.status = task.lead.status = "running";
  const views = new ConversationViews();
  let client: ConversationSnapshot | undefined;
  let appendPackets = 0;
  views.onDidChange((frame) => {
    if (frame.kind === "snapshot") {
      client = frame.snapshot;
      conversationSnapshotSchema.parse(client);
    } else {
      assert.equal(frame.fromRevision, client!.revision);
      const first = client!.rows.window[0];
      client = {
        ...applyConversationDeltas(client!, frame.deltas),
        revision: frame.revision,
        seq: frame.revision,
      };
      if (frame.deltas.every((d) => d.op === "row.delta")) {
        appendPackets++;
        assert.equal(client.rows.window[0], first);
        assert.equal(frame.task, undefined);
      }
    }
    assert.deepEqual(client!.rows.window, projectTwoCodeRows(task));
  });
  const emit = (event: Omit<TaskEvent, "seq" | "at">) => {
    appendEvent(task, event, new Date(1700000000000 + task.events.length * 20).toISOString());
    views.update(task);
  };
  emit({ role: "user", kind: "message", text: "画一个 SVG" });
  for (let i = 0; i < 200; i++)
    emit({ role: "lead", kind: "reasoning", text: `片段${i}`, blockId: "thought" });
  emit({ role: "lead", kind: "message", text: "开始", blockId: "answer" });
  emit({ role: "lead", kind: "message", text: "执行", blockId: "answer" });
  emit({
    role: "lead",
    kind: "tool_input",
    toolCallId: "edit",
    text: JSON.stringify({ tool: "Write", characters: 2, bytes: 2, preview: "{}" }),
  });
  emit({ role: "lead", kind: "tool", toolCallId: "edit", text: "Write" });
  emit({ role: "lead", kind: "tool_end", toolCallId: "edit", text: "success" });
  task.status = task.lead.status = "cancelled";
  emit({ role: "system", kind: "status", text: "正在停止主手与副手" });
  assert(appendPackets >= 199);
  assert.equal(task.events.filter((e) => e.kind === "reasoning").length, 200);
  assert.equal(
    views.snapshot(task).task.events.some((e) => e.kind === "reasoning"),
    false,
  );
  const frozen = structuredClone(client);
  assert.deepEqual(views.snapshot(task).snapshot, frozen);
  views.dispose();
});
