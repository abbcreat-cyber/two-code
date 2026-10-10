import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { piEntry } from "./paths.js";
import { ToolBridge, piToolExtension } from "./tool-bridge.js";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";
import { subscriptionEnvironment } from "./chatgpt-subscription.js";
import { piThinkingLevel } from "../domain/thinking.js";

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === "object" ? (value as Json) : {};
const contentText = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map(object)
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("\n")
    : "";
interface Pending {
  resolve(value: Json): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class PiAdapter implements HarnessAdapter {
  private child?: ChildProcessWithoutNullStreams;
  private bridge?: ToolBridge;
  private readonly pending = new Map<string, Pending>();
  private onRecord?: (record: Json) => void;
  private onFailure?: (error: Error) => void;
  private stderr = "";
  private buffer = "";
  private failure?: Error;
  private async start(input: EngineRun): Promise<void> {
    const entry = await piEntry();
    if (!entry) throw new Error("未找到 Pi CLI，请安装或配置 TWO_CODE_PI_CLI");
    await mkdir(input.sessionDir, { recursive: true });
    const promptFile = join(input.sessionDir, "two-code-instructions.txt");
    await writeFile(promptFile, input.systemPrompt, "utf8");
    const args = [
      entry,
      "--mode",
      "rpc",
      "--session-dir",
      input.sessionDir,
      "--append-system-prompt",
      promptFile,
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
    ];
    if (input.sessionId) args.push("--session", input.sessionId);
    if (input.selection.provider)
      args.push("--provider", input.connection?.subscription ? "openai" : input.selection.provider);
    if (input.selection.model) args.push("--model", input.selection.model);
    if (input.selection.thinking)
      args.push("--thinking", piThinkingLevel(input.selection.thinking));
    let toolEnvironment = {};
    let connectionEnvironment = {};
    if (input.connection?.subscription) {
      // 共用专属授权目录，Pi原生文件锁负责刷新；角色session仍保持独立。
      connectionEnvironment = subscriptionEnvironment(input.connection.subscription);
      args.unshift("--use-env-proxy");
    } else if (input.connection) {
      if (!input.selection.provider) throw new Error("请在模型设置中选择Pi连接");
      const configDir = join(input.sessionDir, "connection");
      await mkdir(configDir, { recursive: true });
      await atomicWritePrivateTextFile(
        join(configDir, "models.json"),
        JSON.stringify({
          providers: { [input.selection.provider]: input.connection.providerConfig },
        }),
      );
      connectionEnvironment = { PI_CODING_AGENT_DIR: configDir };
    }
    {
      this.bridge = new ToolBridge(input);
      await this.bridge.start();
      const extension = join(input.sessionDir, "two-code-tools.mjs");
      await writeFile(extension, piToolExtension, "utf8");
      args.push("--extension", extension);
      toolEnvironment = this.bridge.environment;
    }
    this.child = spawn(
      input.connection?.subscription?.node ?? process.env.TWO_CODE_NODE ?? process.execPath,
      args,
      {
        cwd: input.cwd,
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ...toolEnvironment,
          ...connectionEnvironment,
        },
      },
    );
    this.failure = undefined;
    this.stderr = "";
    this.buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    this.child.stdout.on("data", (chunk: string) => this.parse(chunk));
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code) =>
      this.fail(
        new Error(`Pi 进程退出 (${code})${this.stderr ? `：${this.stderr.slice(-1500)}` : ""}`),
      ),
    );
  }
  private parse(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.fail(new Error("Pi 协议行超过限制"));
      return;
    }
    while (this.buffer.includes("\n")) {
      const end = this.buffer.indexOf("\n"),
        line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      try {
        const record = object(JSON.parse(line));
        if (record.type === "response" && typeof record.id === "string") {
          const pending = this.pending.get(record.id);
          if (!pending) continue;
          this.pending.delete(record.id);
          clearTimeout(pending.timer);
          if (record.success === true) pending.resolve(object(record.data));
          else pending.reject(new Error(String(record.error ?? "Pi 命令被拒绝")));
        } else this.onRecord?.(record);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onFailure?.(error);
  }
  private request(type: string, values: Json = {}): Promise<Json> {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi ${type} 未确认，不能假定已完成`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(JSON.stringify({ id, type, ...values }) + "\n", (error) => {
        if (error) this.fail(error);
      });
    });
  }
  async run(input: EngineRun): Promise<EngineReport> {
    input.signal.throwIfAborted();
    if (this.child) await this.close();
    await this.start(input);
    const state = await this.request("get_state");
    const sessionId = typeof state.sessionFile === "string" ? state.sessionFile : input.sessionId;
    if (sessionId) await input.emit({ kind: "session", text: sessionId });
    const model = object(state.model);
    if (model.id) await input.emit({ kind: "model", text: `${model.provider ?? ""}/${model.id}` });
    let text = "",
      lastError: string | undefined;
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      steps: 0,
      modelMs: 0,
      toolMs: 0,
      ttftMs: null as number | null,
    };
    let modelStart = 0,
      firstToken = 0,
      ttftTotal = 0,
      ttftCount = 0;
    const tools = new Map<string, number>();
    let resolveRun!: () => void, rejectRun!: (error: Error) => void;
    const settled = new Promise<void>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    void settled.catch(() => undefined);
    this.onFailure = rejectRun;
    this.onRecord = (record) => {
      if (record.type === "message_start" && object(record.message).role === "assistant") {
        modelStart = performance.now();
        firstToken = 0;
      }
      if (record.type === "message_update") {
        const delta = object(record.assistantMessageEvent);
        if (
          modelStart &&
          !firstToken &&
          ["text_delta", "thinking_delta", "toolcall_delta"].includes(String(delta.type))
        )
          firstToken = performance.now();
        if (delta.type === "text_delta")
          void input.emit({ kind: "message", text: String(delta.delta ?? "") }).catch(rejectRun);
        if (delta.type === "thinking_delta" || delta.type === "thinking_end")
          void input
            .emit({
              kind: "reasoning",
              text: delta.type === "thinking_end" ? "" : String(delta.delta ?? ""),
            })
            .catch(rejectRun);
      } else if (record.type === "message_end") {
        const message = object(record.message);
        if (message.role === "assistant") {
          const u = object(message.usage);
          if (typeof u.input === "number" && typeof u.output === "number") {
            usage.inputTokens += u.input;
            usage.outputTokens += u.output;
            usage.cacheReadTokens += Number(u.cacheRead ?? 0);
            usage.cacheWriteTokens += Number(u.cacheWrite ?? 0);
            usage.steps++;
            if (modelStart) usage.modelMs += performance.now() - modelStart;
            if (firstToken && modelStart) {
              ttftTotal += firstToken - modelStart;
              ttftCount++;
              usage.ttftMs = ttftTotal / ttftCount;
            }
            void input.usage?.({ ...usage }).catch(rejectRun);
          }
          modelStart = 0;
          text = contentText(message.content);
          lastError = ["error", "aborted"].includes(String(message.stopReason))
            ? String(message.errorMessage ?? message.stopReason)
            : undefined;
        }
      } else if (record.type === "tool_execution_start") {
        tools.set(String(record.toolCallId), performance.now());
        void input
          .emit({ kind: "tool", text: String(record.toolName ?? "工具执行") })
          .catch(rejectRun);
      } else if (record.type === "tool_execution_end") {
        const start = tools.get(String(record.toolCallId));
        if (start) usage.toolMs += performance.now() - start;
        tools.delete(String(record.toolCallId));
      } else if (record.type === "extension_ui_request") {
        void input
          .permission(
            String(record.title ?? "Pi 请求"),
            String(record.message ?? record.method ?? "确认"),
          )
          .then((confirmed) =>
            this.child?.stdin.write(
              JSON.stringify({
                type: "extension_ui_response",
                id: record.id,
                confirmed,
                cancelled: !confirmed,
              }) + "\n",
            ),
          )
          .catch(rejectRun);
      } else if (record.type === "agent_settled")
        lastError ? rejectRun(new Error(lastError)) : resolveRun();
    };
    const abort = () => {
      void this.cancel();
      rejectRun(new Error("Pi 任务已停止"));
    };
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const ack = await this.request("prompt", { message: input.prompt });
      if (ack.disposition === "handled") throw new Error("Pi 处理了命令，但未启动模型任务");
      await settled;
      if (usage.steps) await input.usage?.({ ...usage });
      input.signal.throwIfAborted();
      if (!text) throw new Error("Pi 已结束，但没有可读的最终回复");
      const finalState = await this.request("get_state");
      return {
        text,
        sessionId: typeof finalState.sessionFile === "string" ? finalState.sessionFile : sessionId,
      };
    } finally {
      input.signal.removeEventListener("abort", abort);
      this.onRecord = undefined;
      this.onFailure = undefined;
    }
  }
  async cancel(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    await this.request("abort").catch(() => undefined);
  }
  async close(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null) {
      child.stdin.end();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 1500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.child = undefined;
    await this.bridge?.close();
    this.bridge = undefined;
  }
}
