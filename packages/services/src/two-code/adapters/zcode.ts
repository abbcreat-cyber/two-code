import { randomUUID } from "node:crypto";
import type { IZCodeAgentService, IZCodeSessionService } from "../../index.js";
import type { ZCodeAgentServiceEvent } from "../../index.js";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { ToolBridge } from "./tool-bridge.js";

export class ZCodeAdapter implements HarnessAdapter {
  private session?: { workspacePath: string; sessionId: string };
  private bridge?: ToolBridge;
  constructor(
    private readonly agent: IZCodeAgentService,
    private readonly sessions: IZCodeSessionService,
  ) {}
  private async command(type: CommandEnvelope["type"], payload: unknown) {
    if (!this.session) throw new Error("ZCode 会话尚未建立");
    const ack = await this.agent.sendConversationCommandV4({
      workspacePath: this.session.workspacePath,
      envelope: {
        commandId: randomUUID(),
        clientId: "two-code",
        sessionId: this.session.sessionId,
        type,
        payload,
        issuedAt: Date.now(),
      },
    });
    if (!["accepted", "duplicate", "noop"].includes(ack.status))
      throw new Error(ack.message ?? ack.reasonCode ?? `ZCode ${type}失败`);
    return ack;
  }
  async run(input: EngineRun): Promise<EngineReport> {
    input.signal.throwIfAborted();
    const initialized = await this.agent.initialize({ workspacePath: input.cwd });
    if (!initialized.available)
      throw new Error(initialized.reason ?? "原生 ZCode 尚未配置可用模型");
    if (input.handoff) {
      this.bridge = new ToolBridge(input);
      await this.bridge.start();
    }
    const mcpServers = this.bridge
      ? [
          {
            name: "two_code",
            type: "http" as const,
            url: this.bridge.config.url,
            headers: Object.entries(this.bridge.config.headers).map(([name, value]) => ({
              name,
              value,
            })),
            isolation: "session" as const,
          },
        ]
      : [];
    const model =
      input.selection.model && input.selection.provider
        ? {
            providerId: input.selection.provider,
            modelId: input.selection.model,
            ...(input.selection.thinking
              ? { options: { reasoningLevel: input.selection.thinking } }
              : {}),
          }
        : undefined;
    let sessionId = input.sessionId;
    if (sessionId) {
      await this.sessions.resumeSession({ workspacePath: input.cwd, sessionId, model, mcpServers });
    } else {
      // 与原生桌面一致使用V4创建，避免legacy立即持久化会话绕过V4草稿提升链。
      const created = await this.agent.sendConversationCommandV4({
        workspacePath: input.cwd,
        envelope: {
          commandId: randomUUID(),
          clientId: "two-code",
          sessionId: null,
          type: "createSession",
          issuedAt: Date.now(),
          payload: {
            workspaceId: input.cwd,
            ...(model ? { config: { modelSelection: model } } : {}),
            mcpServers,
          },
        },
      });
      if (created.status !== "accepted" || created.result?.type !== "createSession")
        throw new Error(created.message ?? "原生会话创建失败");
      sessionId = created.result.sessionId;
    }
    this.session = { workspacePath: input.cwd, sessionId };
    await input.emit({ kind: "session", text: sessionId });
    let inputId: string | undefined;
    const buffered: ZCodeAgentServiceEvent[] = [];
    let resolveRun!: (text: string) => void, rejectRun!: (error: Error) => void;
    const done = new Promise<string>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    void done.catch(() => undefined);
    const handle = (item: ZCodeAgentServiceEvent) => {
      if (!inputId) {
        buffered.push(item);
        return;
      }
      if (item.type === "permission.request") {
        void input
          .permission(item.request.toolName, JSON.stringify(item.request.input, null, 2))
          .then((allow) =>
            this.command("resolveInteraction", {
              interactionId: item.request.requestId,
              answer: { action: allow ? "accept" : "decline" },
            }),
          )
          .catch(rejectRun);
        return;
      }
      if (item.type !== "session.event") return;
      const event = item.event;
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : undefined;
      if (event.type === "part.delta" && payload?.field === "text")
        void input.emit({ kind: "message", text: String(payload.delta ?? "") }).catch(rejectRun);
      if (event.type === "tool.updated" && payload?.kind === "scheduled")
        void input
          .emit({ kind: "tool", text: String(payload.toolName ?? "工具") })
          .catch(rejectRun);
      if (payload?.inputId !== inputId) return;
      if (event.type === "turn.completed") {
        if (payload?.resultType && payload.resultType !== "success")
          rejectRun(new Error(`ZCode ${payload.resultType}`));
        else resolveRun(String(payload?.response ?? ""));
      } else if (event.type === "turn.failed")
        rejectRun(new Error(JSON.stringify(payload?.error ?? "原生执行失败")));
    };
    const subscription = this.agent.onDynamicSessionEvent({
      ...this.session,
      deliveryKind: "desktop-continuous",
      includeSnapshot: false,
    })(handle);
    const abort = () => {
      void this.cancel();
      rejectRun(new Error("ZCode 任务已停止"));
    };
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const ack = await this.command("sendText", {
        text: `${input.systemPrompt}\n\n本次任务：\n${input.prompt}`,
        toolDisallowlist: ["Agent", "Task"],
      });
      if (ack.result?.type !== "inputAccepted") throw new Error("ZCode 未返回可关联的输入确认");
      inputId = ack.result.inputId;
      for (const item of buffered) handle(item);
      const text = await done;
      input.signal.throwIfAborted();
      return { text, sessionId };
    } finally {
      subscription.dispose();
      input.signal.removeEventListener("abort", abort);
    }
  }
  async cancel(): Promise<void> {
    if (this.session) await this.command("stop", {}).catch(() => undefined);
  }
  async close(): Promise<void> {
    if (this.session)
      await this.agent
        .closeSession({ ...this.session, expectedPersistence: "immediate" })
        .catch(() => undefined);
    this.session = undefined;
    await this.bridge?.close();
    this.bridge = undefined;
  }
}
