import { openZCodeStream } from "./zcode-stream.js";
import { randomUUID } from "node:crypto";
import type { IZCodeAgentService, IZCodeSessionService } from "../../index.js";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { ToolBridge } from "./tool-bridge.js";

export class ZCodeAdapter implements HarnessAdapter {
  private session?: { workspacePath: string; sessionId: string };
  private bridge?: ToolBridge;
  constructor(
    private readonly agent: IZCodeAgentService,
    _sessions: IZCodeSessionService,
  ) {}
  private async command(type: CommandEnvelope["type"], payload: unknown, commandId = randomUUID()) {
    if (!this.session) throw new Error("ZCode 会话尚未建立");
    const ack = await this.agent.sendConversationCommandV4({
      workspacePath: this.session.workspacePath,
      envelope: {
        commandId,
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
    if (!this.bridge && (input.handoff || input.readHandoffHistory)) {
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
              ? {
                  options: {
                    reasoningLevel:
                      input.selection.thinking === "none" ? "disabled" : input.selection.thinking,
                  },
                }
              : {}),
          }
        : undefined;
    let sessionId = input.sessionId;
    if (sessionId) {
      await this.agent.prepareSessionExecution({
        workspacePath: input.cwd,
        sessionId,
        model,
        mcpServers,
      });
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
    const beforeUsage = await this.agent.getTaskTokenUsage(this.session);
    await input.emit({ kind: "session", text: sessionId });
    const commandId = randomUUID();
    const stream = await openZCodeStream(
      this.agent,
      this.session,
      input,
      commandId,
      (payload) => this.command("resolveInteraction", payload),
      () => this.cancel(),
    );
    try {
      input.signal.throwIfAborted();
      const ack = await this.command(
        "sendText",
        {
          text: `${input.systemPrompt}\n\n本次任务：\n${input.prompt}`,
          // 与原生输入框相同，随本轮Submission冻结配置；独立切换命令需要CAS版本。
          mode: input.mode === "plan" ? "build" : (input.mode ?? "build"),
          planEnabled: input.mode === "plan",
          ...(model ? { modelSelection: model } : {}),
          toolDisallowlist: ["Agent", "Task"],
        },
        commandId,
      );
      if (ack.result?.type !== "inputAccepted") throw new Error("ZCode 未返回可关联的输入确认");
      const text = await stream.done;
      input.signal.throwIfAborted();
      const afterUsage = await this.agent.getTaskTokenUsage(this.session);
      const delta = (
        key:
          | "inputTokens"
          | "outputTokens"
          | "cacheReadTokens"
          | "cacheCreationTokens"
          | "modelRequestCount",
      ) => Math.max(0, afterUsage[key] - beforeUsage[key]);
      // 原生usage的input包含缓存；展示组件约定input仅为未缓存输入。
      await input.usage?.({
        inputTokens: Math.max(
          0,
          delta("inputTokens") - delta("cacheReadTokens") - delta("cacheCreationTokens"),
        ),
        outputTokens: delta("outputTokens"),
        cacheReadTokens: delta("cacheReadTokens"),
        cacheWriteTokens: delta("cacheCreationTokens"),
        steps: delta("modelRequestCount"),
        modelMs: null,
        toolMs: null,
        ttftMs: null,
      });
      return { text, sessionId };
    } catch (error) {
      await this.cancel();
      throw error;
    } finally {
      await stream.close();
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
