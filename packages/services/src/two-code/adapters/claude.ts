import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import {
  query,
  createSdkMcpServer,
  tool,
  type Query,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { claudeExecutable } from "./paths.js";

export class ClaudeAdapter implements HarnessAdapter {
  private active?: Query;
  private abort?: AbortController;
  private child?: ChildProcessWithoutNullStreams;
  private stopping?: Promise<void>;
  async run(input: EngineRun): Promise<EngineReport> {
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
    await input.emit({ kind: "session", text: sessionId });
    const tools = input.handoff
      ? [
          tool(
            "sidekick",
            "将任务交给唯一持久副手，默认等待；收到报告后主手核对证据。",
            { message: z.string().min(1), block: z.boolean().optional() },
            async ({ message, block }) => ({
              content: [{ type: "text" as const, text: await input.handoff!(message, block) }],
            }),
          ),
          tool("read_sidekick", "等待并读取副手报告。", {}, async () => ({
            content: [{ type: "text" as const, text: await input.readSidekick!() }],
          })),
        ]
      : [];
    const effort = ["low", "medium", "high", "xhigh", "max"].includes(
      input.selection.thinking ?? "",
    )
      ? (input.selection.thinking as Options["effort"])
      : undefined;
    let text = "";
    let resultSeen = false;
    try {
      this.active = query({
        prompt: input.prompt,
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
          systemPrompt: { type: "preset", preset: "claude_code", append: input.systemPrompt },
          includePartialMessages: true,
          permissionMode: "default",
          disallowedTools: ["Agent", "Task"],
          ...(tools.length
            ? {
                mcpServers: {
                  two_code: createSdkMcpServer({ name: "two_code", version: "0.1.0", tools }),
                },
                allowedTools: ["mcp__two_code__sidekick", "mcp__two_code__read_sidekick"],
              }
            : {}),
          canUseTool: async (name, args) => {
            const allowed = await input.permission(name, JSON.stringify(args, null, 2));
            return allowed
              ? { behavior: "allow", updatedInput: args }
              : { behavior: "deny", message: "用户未批准此操作" };
          },
          env: { ...process.env, CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false" },
        },
      });
      for await (const message of this.active) {
        input.signal.throwIfAborted();
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta")
            await input.emit({ kind: "message", text: event.delta.text });
        } else if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") await input.emit({ kind: "tool", text: block.name });
          }
        } else if (message.type === "system" && message.subtype === "init") {
          await input.emit({ kind: "model", text: message.model });
        } else if (message.type === "result") {
          resultSeen = true;
          if (message.subtype !== "success" || message.is_error)
            throw new Error(
              message.subtype === "success" ? message.result : message.errors.join("\n"),
            );
          text = message.result;
        }
      }
      if (!resultSeen) throw new Error("Claude Code 已退出但未返回结算结果");
      return { text, sessionId };
    } finally {
      input.signal.removeEventListener("abort", stop);
      await this.stopping;
      this.active?.close();
      this.active = undefined;
      this.child = undefined;
    }
  }
  cancel(): Promise<void> {
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
    if (this.active) await this.cancel();
    this.active?.close();
    this.active = undefined;
  }
}
