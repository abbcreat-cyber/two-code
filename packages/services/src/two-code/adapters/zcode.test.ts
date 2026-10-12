import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Emitter } from "@zcode/rpc";
import type { IZCodeAgentService, IZCodeSessionService } from "../../index.js";
import type { EngineEvent, EngineRun } from "../app/ports.js";
import { ZCodeAdapter } from "./zcode.js";
import { ZCodeProjection } from "./zcode-projection.js";
import { conversationTopicFrameSchema } from "@zcode/shared/zcode-protocol-v4";

const base = JSON.parse(
  await readFile(new URL("./fixtures/zcode-v4-base.json", import.meta.url), "utf8"),
);
function fixture(finish = true) {
  const stream = new Emitter<any>();
  let state = structuredClone(base),
    subscriptionId = "",
    ordinal = 0,
    turns = 0;
  const commands: string[] = [],
    prepares: string[] = [],
    mcpConfigs: any[] = [];
  const publish = (rows: any[]) => {
    state = {
      ...state,
      seq: state.seq + 1,
      rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
    };
    const frame = {
      wireVersion: 3,
      kind: "complete",
      deliveryKind: ordinal === 0 ? "initial" : "online",
      logicalFrameId: `f${++ordinal}`,
      logicalFrameOrdinal: ordinal,
      topic: "conversation/native-fixture",
      subscriptionId,
      frame: {
        topic: "conversation/native-fixture",
        subscriptionId,
        sentAt: Date.now(),
        fromSeq: 0,
        toSeq: state.seq,
        payload: { kind: "snapshot", snapshot: state },
      },
    };
    stream.fire(frame);
    stream.fire(frame); // 同帧重放必须幂等。
  };
  const agent = {
    initialize: async () => ({ available: true }),
    prepareSessionExecution: async (p: any) => {
      prepares.push(p.sessionId);
      mcpConfigs.push(p.mcpServers);
    },
    getTaskTokenUsage: async () => ({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      modelRequestCount: 1,
    }),
    onDynamicSessionEvent: () => {
      throw Error("旧事件通道不支持当前CLI");
    },
    onDynamicConversationFrame: () => stream.event,
    subscribeConversationV4: async () => {
      subscriptionId = `sub-${turns}`;
      ordinal = 0;
      publish(state.rows.window);
      return { ack: { subscriptionId, mode: "snapshot", logEpoch: state.logEpoch } };
    },
    unsubscribeConversationV4: async () => {},
    closeSession: async () => true,
    sendConversationCommandV4: async ({ envelope }: any) => {
      commands.push(envelope.type);
      if (envelope.type === "createSession") {
        mcpConfigs.push(envelope.payload.mcpServers);
        return {
          status: "accepted",
          result: { type: "createSession", sessionId: "native-fixture" },
        };
      }
      if (envelope.type === "sendText") {
        const n = ++turns,
          history = state.rows.window;
        const common = {
          rowId: n * 10,
          turnId: `turn-${n}`,
          productTurnId: `turn-${n}`,
          createdAt: 1,
          createdAtSeq: 1,
        };
        const header = {
          ...common,
          kind: "turnHeader",
          origin: "userInput",
          sourceCommandId: envelope.commandId,
          state: "running",
          startedAt: 1,
        };
        const text = {
          ...common,
          rowId: n * 10 + 1,
          kind: "assistantText",
          text: "开场。",
          state: "streaming",
        };
        const reasoning = {
          ...common,
          rowId: n * 10 + 2,
          kind: "reasoning",
          text: "核对中",
          state: "streaming",
        };
        const tool = {
          ...common,
          rowId: n * 10 + 3,
          kind: "toolCall",
          toolCallId: `tool-${n}`,
          toolName: "Bash",
          status: "running",
          inputText: '{"command":"node check.mjs"}',
        };
        publish([...history, header, text, reasoning, tool]);
        if (finish)
          queueMicrotask(() =>
            publish([
              ...history,
              { ...header, state: "completedSuccess" },
              { ...text, text: "开场。完成。", state: "complete" },
              { ...reasoning, state: "complete" },
              { ...tool, status: "success", output: { text: "PASS: native fixture" } },
            ]),
          );
        return {
          status: "accepted",
          result: { type: "inputAccepted", inputId: `input-${n}`, delivery: "startNow" },
        };
      }
      return { status: "accepted" };
    },
  } as unknown as IZCodeAgentService;
  const sessions = {
    resumeSession: async () => {
      throw Error("旧消息投影结构已不兼容");
    },
  } as unknown as IZCodeSessionService;
  return { agent, sessions, commands, prepares, mcpConfigs, close: () => stream.dispose() };
}
function input(events: EngineEvent[], signal = new AbortController().signal): EngineRun {
  return {
    cwd: "D:/fixture",
    sessionDir: "D:/fixture/session",
    selection: { harness: "zcode", provider: "bigmodel-api", model: "GLM-5.3", thinking: "max" },
    mode: "yolo",
    prompt: "测试",
    systemPrompt: "",
    signal,
    emit: async (e) => {
      events.push(e);
    },
    permission: async () => false,
  };
}
test(
  "ZCode只消费V4：ACK前首帧、正文/思考/工具回执、重复帧与原生终态",
  { timeout: 5000 },
  async (t) => {
    const f = fixture();
    t.after(f.close);
    const adapter = new ZCodeAdapter(f.agent, f.sessions);
    t.after(() => adapter.close());
    const events: EngineEvent[] = [];
    const result = await adapter.run(input(events));
    assert.equal(result.sessionId, "native-fixture");
    assert.equal(result.text, "开场。完成。");
    assert.equal(
      events
        .filter((e) => e.kind === "message")
        .map((e) => e.text)
        .join(""),
      "开场。完成。",
    );
    assert.equal(
      events
        .filter((e) => e.kind === "reasoning")
        .map((e) => e.text)
        .join(""),
      "核对中",
    );
    assert.equal(events.filter((e) => e.kind === "tool").length, 1);
    assert.equal(events.filter((e) => e.kind === "tool_end").length, 1);
    const receipt = JSON.parse(events.find((e) => e.kind === "verification")!.text);
    assert.deepEqual(receipt.summaries, ["PASS: native fixture"]);
    assert(events.some((e) => e.kind === "model" && e.text === "GLM-5.3"));
  },
);
test("关闭后续问保留原会话，通过执行准备恢复，不重放旧正文", { timeout: 5000 }, async (t) => {
  const f = fixture();
  t.after(f.close);
  let adapter = new ZCodeAdapter(f.agent, f.sessions);
  const first = await adapter.run(input([]));
  await adapter.close();
  adapter = new ZCodeAdapter(f.agent, f.sessions);
  t.after(() => adapter.close());
  const events: EngineEvent[] = [];
  const second = await adapter.run({ ...input(events), sessionId: first.sessionId });
  assert.equal(second.sessionId, first.sessionId);
  assert.deepEqual(f.prepares, ["native-fixture"]);
  assert.equal(f.commands.filter((c) => c === "createSession").length, 1);
  assert.equal(
    events
      .filter((e) => e.kind === "message")
      .map((e) => e.text)
      .join(""),
    "开场。完成。",
  );
});
test("阻塞副手的MCP预算在创建与恢复时一致且仅作用于自有服务", async (t) => {
  const f = fixture();
  t.after(f.close);
  const adapter = new ZCodeAdapter(f.agent, f.sessions);
  t.after(() => adapter.close());
  const params = { ...input([]), handoff: async () => "完成" };
  const first = await adapter.run(params);
  await adapter.run({ ...params, sessionId: first.sessionId });
  assert.equal(f.mcpConfigs.length, 2);
  for (const servers of f.mcpConfigs) {
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, "two_code");
    assert.equal(servers[0].timeoutMs, 30 * 60 * 1000);
  }
});

test("取消等待中的ZCode发送stop且不把旧完成状态算作本轮成功", { timeout: 5000 }, async (t) => {
  const f = fixture(false);
  t.after(f.close);
  const adapter = new ZCodeAdapter(f.agent, f.sessions);
  t.after(() => adapter.close());
  const controller = new AbortController();
  const run = input([], controller.signal);
  run.emit = async (e) => {
    if (e.kind === "message") controller.abort();
  };
  await assert.rejects(adapter.run(run), /停止|abort/i);
  assert(f.commands.includes("stop"));
});

test("V4增量有序追加，帧重放不重复，断档必须失败", () => {
  const p = new ZCodeProjection("command");
  const snapshot = structuredClone(base);
  const frame = (fromSeq: number, toSeq: number, payload: unknown) =>
    conversationTopicFrameSchema.parse({
      topic: "conversation/native-fixture",
      subscriptionId: "sub",
      sentAt: 1,
      fromSeq,
      toSeq,
      payload,
    });
  p.accept(frame(0, 0, { kind: "snapshot", snapshot }));
  p.arm();
  const common = { rowId: 1, turnId: "turn", createdAt: 1, createdAtSeq: 1 };
  const first = frame(0, 1, {
    kind: "deltas",
    deltas: [
      {
        op: "row.appended",
        row: {
          ...common,
          kind: "turnHeader",
          origin: "userInput",
          sourceCommandId: "command",
          state: "running",
          startedAt: 1,
        },
      },
      {
        op: "row.appended",
        row: { ...common, rowId: 2, kind: "assistantText", text: "开", state: "streaming" },
      },
    ],
  });
  assert.equal(
    p
      .accept(first)
      .events.filter((e) => e.kind === "message")
      .map((e) => e.text)
      .join(""),
    "开",
  );
  assert.deepEqual(p.accept(first).events, []);
  const second = frame(1, 2, {
    kind: "deltas",
    deltas: [{ op: "row.delta", rowId: 2, path: "text", append: "场。" }],
  });
  assert.equal(p.accept(second).events[0]?.text, "场。");
  assert.throws(() => p.accept(frame(4, 5, { kind: "deltas", deltas: [] })), /序列不连续/);
});

test("明确权限拒绝投影not-executed；普通工具错误保留failed摘要", () => {
  const p = new ZCodeProjection("command");
  p.arm();
  const snapshot = structuredClone(base);
  const common = { rowId: 1, turnId: "turn", createdAt: 1, createdAtSeq: 1 };
  snapshot.seq = 1;
  snapshot.rows = {
    window: [
      {
        ...common,
        kind: "turnHeader",
        origin: "userInput",
        sourceCommandId: "command",
        state: "running",
        startedAt: 1,
      },
      {
        ...common,
        rowId: 2,
        kind: "toolCall",
        toolCallId: "denied",
        toolName: "Bash",
        status: "error",
        inputText: "{}",
        error: { code: "denied", message: "rejected" },
        output: { text: "PASS: must not survive" },
      },
      {
        ...common,
        rowId: 3,
        kind: "toolCall",
        toolCallId: "failed",
        toolName: "Bash",
        status: "error",
        inputText: "{}",
        error: { code: "exit", message: "failed" },
        output: { text: "FAIL: fixture\nExit code 7" },
      },
    ],
    totalCount: 3,
    firstRowId: 1,
  };
  p.deny("denied");
  const output = p.accept(
    conversationTopicFrameSchema.parse({
      topic: "conversation/native-fixture",
      subscriptionId: "sub",
      sentAt: 1,
      fromSeq: 0,
      toSeq: 1,
      payload: { kind: "snapshot", snapshot },
    }),
  );
  const receipts = output.events
    .filter((e) => e.kind === "verification")
    .map((e) => JSON.parse(e.text));
  assert.equal(receipts[0].status, "not-executed");
  assert.deepEqual(receipts[0].summaries, []);
  assert.equal(receipts[1].status, "failed");
  assert.equal(receipts[1].reportedExitCode, 7);
});
