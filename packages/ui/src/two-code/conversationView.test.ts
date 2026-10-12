import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TwoCodeViewFrame, TwoCodeViewSnapshot } from "@zcode/services";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import { applyTwoCodeView } from "./conversationView.js";

function fixture(): TwoCodeViewSnapshot {
  const frame: TwoCodeViewSnapshot = JSON.parse(readFileSync(new URL("./conversationView.fixture.json", import.meta.url), "utf8"));
  conversationSnapshotSchema.parse(frame.snapshot);
  return frame;
}
test("native row reducer keeps history identity, rejects gaps and ignores late frames", () => {
  const first = fixture();
  const packet: TwoCodeViewFrame = { kind:"delta",taskId:first.task.id,workspacePath:first.task.workspacePath,epoch:first.snapshot.logEpoch,fromRevision:1,revision:2,deltas:[{op:"row.delta",rowId:20,path:"text",append:" next"}] };
  const second = applyTwoCodeView(first,packet)!;
  assert.equal(second.task,first.task);
  assert.equal(second.snapshot.rows.window[0],first.snapshot.rows.window[0]);
  assert.notEqual(second.snapshot.rows.window[2],first.snapshot.rows.window[2]);
  assert.deepEqual(first,fixture());
  assert.equal(applyTwoCodeView(second,packet),second);
  assert.equal(applyTwoCodeView(second,first),second);
  assert.equal(applyTwoCodeView(first,{...packet,fromRevision:2,revision:3}),null);
  assert.equal(applyTwoCodeView(undefined,packet),null);
});
test("changed Host epoch requires authoritative resync instead of applying foreign deltas", () => {
  const first=fixture(),restarted=fixture();
  restarted.snapshot.logEpoch='new-host';
  assert.equal(applyTwoCodeView(first,restarted),null);
  assert.equal(applyTwoCodeView(first,restarted,true),restarted);
});
