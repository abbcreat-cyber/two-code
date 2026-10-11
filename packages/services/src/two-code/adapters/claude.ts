import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import {
  query,
  createSdkMcpServer,
  tool,
  type Query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { claudeExecutable } from "./paths.js";
import { handoffToolDescription } from "../domain/handoffs.js";
import { InputStream } from "./input-stream.js";
import { permissionDenied } from "./permission-feedback.js";
import { viewImage, visionDescription } from "./vision.js";
import { claudeConnection } from "./claude-connection.js";

export class ClaudeAdapter implements HarnessAdapter {
  private active?: Query;
  private abort?: AbortController;
  private child?: ChildProcessWithoutNullStreams;
  private stopping?: Promise<void>;
  private inbox?: InputStream<SDKUserMessage>;
  private messageId?: ReturnType<typeof randomUUID>;
  private sessionId?: string;
  private updates = 0;
  private updateFailure?: Error;
  private updateTail: Promise<void> = Promise.resolve();
  private updateReady?: ReturnType<typeof Promise.withResolvers<void>>;
  private generation = 0;
  private runSignal?: AbortSignal;
  async run(input: EngineRun): Promise<EngineReport> {
    this.generation++;
    this.runSignal = input.signal;
    this.updateReady = Promise.withResolvers<void>();
    void this.updateReady.promise.catch(() => {});
    const executable = await claudeExecutable();
    if (!executable) throw new Error("未找到 Claude Code，请安装 CLI 或配置 TWO_CODE_CLAUDE_CLI");
    input.signal.throwIfAborted();
    this.abort = new AbortController();
    this.stopping = undefined;
    const stop = () => {
      void this.cancel();
    };
    input.signal.addEventListener("abort", stop, { once: true });
    const sessionId = input.sessionId ?? randomUUID();
    this.sessionId = sessionId;
    this.inbox = new InputStream<SDKUserMessage>();
    this.messageId = randomUUID();
    this.updates = 0;
    this.updateFailure = undefined;
    this.updateTail = Promise.resolve();
    this.inbox.push({
      type: "user",
      message: { role: "user", content: input.prompt },
      parent_tool_use_id: null,
      session_id: sessionId,
      uuid: this.messageId,
    });
    await input.emit({ kind: "session", text: sessionId });
    const tools = [
      tool("view_image", visionDescription, { path: z.string().min(1) }, ({ path }) =>
        viewImage(input, path),
      ),
      ...(input.handoff
        ? [
            tool(
              "sidekick",
              handoffToolDescription,
              { message: z.string().min(1), block: z.boolean().optional() },
              async ({ message, block }) => ({
                content: [{ type: "text" as const, text: await input.handoff!(message, block) }],
              }),
            ),
            tool("read_sidekick", "等待并读取副手报告。", {}, async () => ({
              content: [{ type: "text" as const, text: await input.readSidekick!() }],
            })),
          ]
        : []),
      ...(input.readHandoffHistory
        ? [
            tool(
              "read_handoff_history",
              "逐字读取本任务交接历史，按nextOffset翻页，不依赖摘要猜测原文。",
              { offset: z.number().int().nonnegative().optional() },
              async ({ offset }) => ({
                content: [{ type: "text" as const, text: await input.readHandoffHistory!(offset) }],
              }),
            ),
          ]
        : []),
    ];
    const effort = ["low", "medium", "high", "xhigh", "max"].includes(
      input.selection.thinking ?? "",
    )
      ? (input.selection.thinking as Options["effort"])
      : undefined;
    let text = "";
    const connection = await claudeConnection(
        input.connection,
        join(input.sessionDir, "visual-transport.json"),
      ),
      connectionEnv = connection.env;
    const partialUsage = new Map<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      }
    >();
    let resultSeen = false;
    let responseId: string = randomUUID();
    try {
      this.active = query({
        prompt: this.inbox,
        options: {
          cwd: input.cwd,
          pathToClaudeCodeExecutable: executable,
          abortController: this.abort,
          spawnClaudeCodeProcess: (options) => {
            this.child = spawn(options.command, options.args, {
              cwd: options.cwd,
              env: options.env,
              signal: options.signal,
              windowsHide: true,
              detached: process.platform !== "win32",
              stdio: "pipe",
            });
            return this.child;
          },
          ...(input.sessionId ? { resume: input.sessionId } : { sessionId }),
          ...(input.selection.model ? { model: input.selection.model } : {}),
          ...(effort ? { effort } : {}),
          ...(["none", "disabled", "off"].includes(input.selection.thinking ?? "")
            ? { thinking: { type: "disabled" as const } }
            : {}),
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append:
              input.systemPrompt +
              (process.platform === "win32"
                ? "\n执行PowerShell脚本时，优先使用当前提供的原生PowerShell工具，command直接填写原始脚本，不经Bash套powershell -Command。若当前CLI未提供此工具，请明确说明能力缺失，不伪称已原生执行。"
                : ""),
          },
          includePartialMessages: true,
          ...(connectionEnv ? { settings: { env: connectionEnv } } : {}),
          permissionMode:
            input.mode === "yolo"
              ? "bypassPermissions"
              : input.mode === "plan"
                ? "plan"
                : "default",
          allowDangerouslySkipPermissions: input.mode === "yolo",
          // PreToolUse也覆盖本机已允许的工具，避免本机allow规则绕开本任务的权限模式。
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (event) => {
                    if (event.hook_event_name !== "PreToolUse") return {};
                    const allow = await input.permission(
                      event.tool_name,
                      JSON.stringify(event.tool_input),
                    );
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: allow ? "allow" : "deny",
                        permissionDecisionReason: allow
                          ? "Two Code任务权限模式允许"
                          : permissionDenied(
                              input,
                              event.tool_name,
                              JSON.stringify(event.tool_input),
                            ),
                      },
                    };
                  },
                ],
              },
            ],
          },
          disallowedTools: [
            "Agent",
            "Task",
            ...(input.role === "sidekick"
              ? [
                  "AskUserQuestion",
                  "EnterPlanMode",
                  "ExitPlanMode",
                  "SendMessage",
                  "TeamCreate",
                  "TeamDelete",
                  "Workflow",
                  "ListAgents",
                  "PushNotification",
                  "ScheduleWakeup",
                  "CronCreate",
                  "CronDelete",
                  "ReportFindings",
                ]
              : []),
          ],
          ...(tools.length
            ? {
                mcpServers: {
                  two_code: createSdkMcpServer({ name: "two_code", version: "0.1.0", tools }),
                },
              }
            : {}),
          canUseTool: async (name, args) => {
            const allowed = await input.permission(name, JSON.stringify(args, null, 2));
            return allowed
              ? { behavior: "allow", updatedInput: args }
              : { behavior: "deny", message: permissionDenied(input, name, JSON.stringify(args)) };
          },
          env: { ...process.env, ...connectionEnv, CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false" },
        },
      });
      this.updateReady.resolve();
      for await (const message of this.active) {
        input.signal.throwIfAborted();
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "message_start") responseId = event.message.id;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta")
            await input.emit({
              kind: "message",
              text: event.delta.text,
              blockId: `${responseId}:${event.index}`,
            });
          if (event.type === "content_block_delta" && event.delta.type === "thinking_delta")
            await input.emit({
              kind: "reasoning",
              text: event.delta.thinking,
              blockId: `${responseId}:${event.index}`,
            });
          if (event.type === "content_block_stop")
            await input.emit({ kind: "reasoning", text: "" });
        } else if (message.type === "assistant") {
          const u = message.message.usage;
          if (u) {
            partialUsage.set(message.message.id, {
              inputTokens: u.input_tokens,
              outputTokens: u.output_tokens,
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
            });
            const totals = [...partialUsage.values()].reduce(
              (sum, item) => ({
                inputTokens: sum.inputTokens + item.inputTokens,
                outputTokens: sum.outputTokens + item.outputTokens,
                cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
                cacheWriteTokens: sum.cacheWriteTokens + item.cacheWriteTokens,
              }),
              { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            );
            // 同一个assistant id会分块重复到达；保留最新值，最终result再替换本轮回执。
            await input.usage?.({
              ...totals,
              steps: partialUsage.size,
              modelMs: null,
              toolMs: null,
              ttftMs: null,
            });
          }
          for (const block of message.message.content) {
            if (block.type === "tool_use") await input.emit({ kind: "tool", text: block.name });
          }
        } else if (message.type === "system" && message.subtype === "init") {
          await input.emit({ kind: "model", text: message.model, availableTools: message.tools });
        } else if (message.type === "result") {
          // interrupt的旧结果不能结束已提交更新的交接；等匹配原生user_message_uuid的回执。
          if (this.updates && message.user_message_uuid !== this.messageId) {
            if (!message.user_message_uuid)
              throw new Error("Claude未返回更新消息身份，不能假定已收到更新");
            continue;
          }
          this.inbox.finish();
          resultSeen = true;
          const totals = Object.values(message.modelUsage).reduce(
            (sum, u) => ({
              inputTokens: sum.inputTokens + u.inputTokens,
              outputTokens: sum.outputTokens + u.outputTokens,
              cacheReadTokens: sum.cacheReadTokens + u.cacheReadInputTokens,
              cacheWriteTokens: sum.cacheWriteTokens + u.cacheCreationInputTokens,
            }),
            { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          );
          await input.usage?.({
            ...totals,
            steps: message.num_turns,
            modelMs: message.duration_api_ms,
            toolMs: null,
            ttftMs: message.subtype === "success" ? (message.ttft_ms ?? null) : null,
          });
          if (message.subtype !== "success" || message.is_error)
            throw new Error(
              message.subtype === "success" ? message.result : message.errors.join("\n"),
            );
          text = message.result;
        }
      }
      if (!resultSeen) throw new Error("Claude Code 已退出但未返回结算结果");
      if (this.updateFailure) throw this.updateFailure;
      return { text, sessionId };
    } finally {
      this.updateReady.reject(new Error("Claude本轮已结束"));
      input.signal.removeEventListener("abort", stop);
      this.inbox.finish();
      await this.stopping;
      this.active?.close();
      await connection.close();
      this.active = undefined;
      this.child = undefined;
    }
  }
  update(message: string): Promise<void> {
    const generation = this.generation,
      ready = this.updateReady;
    const update = this.updateTail.then(async () => {
      await ready?.promise;
      if (generation !== this.generation) throw new Error("原交接已结束，更新未送达");
      this.runSignal?.throwIfAborted();
      if (!this.active || !this.inbox || this.inbox.closed)
        throw new Error("副手已结束，更新未送达；请先读报告再重新派工");
      this.messageId = randomUUID();
      this.updates++;
      const active = this.active,
        inbox = this.inbox;
      try {
        const receipt = await active.interrupt();
        if (generation !== this.generation || this.active !== active)
          throw new Error("原交接已结束，不能将更新送入后续交接");
        this.runSignal?.throwIfAborted();
        if (receipt?.still_queued?.length)
          throw new Error("原生交接仍在排队，不能确认旧任务已经中断");
        inbox.push({
          type: "user",
          message: { role: "user", content: message },
          parent_tool_use_id: null,
          session_id: this.sessionId,
          uuid: this.messageId,
          priority: "now",
        });
      } catch (error) {
        if (generation !== this.generation || this.active !== active) throw error;
        this.updateFailure = new Error(`Claude更新未确认送达：${String(error)}`);
        inbox.finish();
        await this.cancel();
        throw this.updateFailure;
      }
    });
    this.updateTail = update.catch(() => {});
    return update;
  }
  cancel(): Promise<void> {
    this.inbox?.finish();
    if (this.stopping) return this.stopping;
    this.stopping = this.stopTree();
    return this.stopping;
  }
  private async stopTree(): Promise<void> {
    const child = this.child;
    // 先清理本适配器持有的进程树，再让SDK关闭父进程，否则Windows会留下正在执行的工具。
    if (child?.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn(
            join(process.env.SystemRoot || "C:/Windows", "System32/taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("exit", () => resolve());
          killer.once("error", () => resolve());
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* 已退出。 */
        }
      }
    }
    this.abort?.abort();
  }
  async close(): Promise<void> {
    this.updateReady?.reject(new Error("Claude会话已关闭"));
    if (this.active) await this.cancel();
    this.active?.close();
    this.active = undefined;
  }
}
