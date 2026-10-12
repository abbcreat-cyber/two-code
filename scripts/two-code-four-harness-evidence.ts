import fs from "node:fs/promises";
import assert from "node:assert/strict";
import type { IZCodeAgentService } from "../packages/services/src/index.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";
import { nativeModels } from "./two-code-role-swap-metrics.js";

export function zcodeSnapshotEvidence(snapshot: any, selection: unknown, sessionId: string) {
  const rows = snapshot.rows.window;
  const tools = rows.filter((r: any) => r.kind === "toolCall");
  return {
    selection,
    sessionId,
    models: [snapshot.config.model],
    modelSelection: snapshot.config.modelSelection,
    identityEvidence: "native-v4-config-and-completed-turn",
    mode: snapshot.config.mode,
    thinking: snapshot.config.thought,
    toolFailures: tools.filter((r: any) => r.error || r.status === "error"),
    tools,
    historyComplete: rows.length === snapshot.rows.totalCount,
    phase: snapshot.control.phase,
  };
}

export async function matrixEvidence(task: TwoCodeTask, agent: IZCodeAgentService, root: string) {
  const nonZ = structuredClone(task);
  for (const role of ["lead", "sidekick"] as const)
    if (nonZ[role].selection.harness === "zcode") delete nonZ[role].sessionId;
  const result: any = await nativeModels(nonZ);
  for (const role of ["lead", "sidekick"] as const) {
    const actor = task[role];
    if (actor.selection.harness !== "zcode" || !actor.sessionId) continue;
    const target = { workspacePath: task.workspacePath, sessionId: actor.sessionId };
    // 结束会话不再支持旧session/read；订阅V4历史首帧，无模型请求、无新一轮输入。
    const ready = Promise.withResolvers<any>();
    const sub = agent.onDynamicConversationFrame({ workspacePath: task.workspacePath })((
      candidate: any,
    ) => {
      if (
        candidate.kind === "complete" &&
        candidate.frame?.payload?.kind === "snapshot" &&
        candidate.frame.topic === `conversation/${actor.sessionId}`
      )
        ready.resolve(candidate.frame.payload.snapshot);
    });
    let subscriptionId: string | undefined;
    const timer = setTimeout(
      () => ready.reject(new Error("ZCode原生V4历史首帧未到达或需要分块重组")),
      15000,
    );
    void ready.promise.catch(() => {});
    try {
      const response = await agent.subscribeConversationV4({ ...target, visibility: "background" });
      subscriptionId = response.ack.subscriptionId;
      const snapshot = await ready.promise;
      assert.equal(snapshot.config.model.toLowerCase(), "glm-5.3");
      assert.equal(snapshot.config.thought, "max");
      assert.equal(snapshot.config.mode, "yolo");
      result[role] = zcodeSnapshotEvidence(snapshot, actor.selection, actor.sessionId);
      await fs.writeFile(
        `${root}/${task.id}-${role}-zcode.json`,
        JSON.stringify(snapshot, null, 2),
      );
    } finally {
      clearTimeout(timer);
      sub.dispose();
      if (subscriptionId)
        await agent.unsubscribeConversationV4({
          workspacePath: task.workspacePath,
          subscriptionId,
        });
    }
  }
  return result;
}
