import type { IZCodeAgentService } from "../../index.js";
import {
  TopicWireFrameAssembler,
  conversationTopicFrameSchema,
  type ConversationTopicWireCandidate,
  type PendingInteraction,
} from "@zcode/shared/zcode-protocol-v4";
import type { EngineRun } from "../app/ports.js";
import { ZCodeProjection } from "./zcode-projection.js";

export async function openZCodeStream(
  agent: IZCodeAgentService,
  target: { workspacePath: string; sessionId: string },
  input: EngineRun,
  commandId: string,
  resolveInteraction: (payload: unknown) => Promise<unknown>,
  stop: () => Promise<void>,
) {
  const projection = new ZCodeProjection(commandId);
  const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  const ready = Promise.withResolvers<void>(),
    done = Promise.withResolvers<string>();
  void ready.promise.catch(() => {});
  void done.promise.catch(() => {});
  let subscriptionId: string | undefined,
    closed = false,
    failed = false,
    tail: Promise<void> = Promise.resolve();
  const buffered: ConversationTopicWireCandidate[] = [];
  const fail = (error: unknown) => {
    if (!closed && !failed) {
      failed = true;
      ready.reject(error);
      done.reject(error);
    }
  };
  const interact = async (request: PendingInteraction) => {
    if (request.payload.kind !== "permission")
      throw Error(`ZCode需要处理${request.payload.kind}交互，不能自动编造答案`);
    const payload = request.payload;
    const allow = await input.permission(payload.toolName, JSON.stringify(payload.detail));
    if (closed || failed || input.signal.aborted) return;
    const option = payload.options.find((o) => o.kind === (allow ? "allowOnce" : "deny"));
    if (!option) throw Error("ZCode权限交互缺少单次允许或拒绝选项");
    if (!allow) projection.deny(payload.toolCallId);
    await resolveInteraction({
      interactionId: request.interactionId,
      answer: { optionId: option.optionId },
    });
  };
  const handle = (candidate: ConversationTopicWireCandidate) => {
    if (closed || failed || candidate.topic !== `conversation/${target.sessionId}`) return;
    if (!subscriptionId) {
      buffered.push(candidate);
      return;
    }
    if (candidate.subscriptionId !== subscriptionId) return;
    for (const item of assembler.accept(candidate)) {
      if (item.kind === "fault") {
        fail(Error(`ZCode V4帧校验失败：${item.fault.reasonCode}`));
        continue;
      }
      tail = tail
        .then(async () => {
          if (closed || failed || input.signal.aborted) return;
          const output = projection.accept(item.frame);
          if (projection.snapshot) ready.resolve();
          for (const event of output.events) {
            input.signal.throwIfAborted();
            await input.emit(event);
          }
          for (const request of output.interactions) void interact(request).catch(fail);
          if (output.error) done.reject(output.error);
          if (output.completed !== undefined) done.resolve(output.completed);
        })
        .catch(fail);
    }
  };
  const listener = agent.onDynamicConversationFrame({ workspacePath: target.workspacePath })(
    handle,
  );
  const abort = () => {
    fail(Error("ZCode任务已停止"));
    void stop().catch(fail);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  const expiry = setInterval(() => {
    for (const event of assembler.expire())
      if (event.kind === "fault") fail(Error(`ZCode V4帧组装失败：${event.fault.reasonCode}`));
  }, 1000);
  const close = async () => {
    closed = true;
    clearInterval(expiry);
    listener.dispose();
    input.signal.removeEventListener("abort", abort);
    assembler.clear();
    if (subscriptionId)
      await agent
        .unsubscribeConversationV4({ workspacePath: target.workspacePath, subscriptionId })
        .catch(() => {});
    await tail;
  };
  try {
    const response = await agent.subscribeConversationV4({ ...target, visibility: "foreground" });
    subscriptionId = response.ack.subscriptionId;
    for (const frame of buffered) handle(frame);
    buffered.length = 0;
    input.signal.throwIfAborted();
    await ready.promise;
    if (projection.snapshot!.pendingInteractions.length)
      throw Error("ZCode原生会话仍有未完成交互，请先处理后续接");
    projection.arm();
    return { done: done.promise, close };
  } catch (error) {
    await close();
    throw error;
  }
}
