import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { EngineRun, EngineReport, HarnessAdapter } from "../app/ports.js";
import { piEntry, stepExecutable } from "./paths.js";
import { ToolBridge, piToolExtension, stepToolExtension } from "./tool-bridge.js";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";
import { subscriptionEnvironment } from "./chatgpt-subscription.js";
import { piThinkingLevel } from "../domain/thinking.js";
import { handleExtensionUi } from "./pi-extension-ui.js";
import { writeStepOpeningExtension } from "./step-opening.js";
import { rejectedToolEvent } from "./tool-outcome.js";
import { nativeDeltaEvent } from "./stream-event.js";

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
  constructor(private readonly harness: "pi" | "step-code" = "pi") {}
  private get label() {
    return this.harness === "step-code" ? "Step Code" : "Pi";
  }
  private child?: ChildProcessWithoutNullStreams;
  private bridge?: ToolBridge;
  private readonly pending = new Map<string, Pending>();
  private onRecord?: (record: Json) => void;
  private onFailure?: (error: Error) => void;
  private stderr = "";
  private buffer = "";
  private failure?: Error;
  private updateReady?: ReturnType<typeof Promise.withResolvers<void>>;
  private runSignal?: AbortSignal;
  private async start(input: EngineRun): Promise<void> {
    const step = this.harness === "step-code";
    const entry = step ? await stepExecutable() : await piEntry();
    if (!entry) throw new Error(`未找到 ${this.label} CLI，请安装或配置对应底座路径`);
    if (step && (!input.connection || !input.selection.provider))
      throw new Error("请选择Step Code的API或订阅连接，不会回退到其他渠道");
    await mkdir(input.sessionDir, { recursive: true });
    const promptFile = join(input.sessionDir, "two-code-instructions.txt");
    await writeFile(
      promptFile,
      input.systemPrompt +
        (process.platform === "win32"
          ? "\n当前是Windows。读取文件优先用read_file/read，查找用find_files/find。只有任务允许命令时才执行：PowerShell脚本直接交给原生powershell工具，不经run_command或Bash包装；不要用pwd && ls、od、wc等Unix命令代替文件读取。"
          : ""),
      "utf8",
    );
    const args = [
      ...(step ? [] : [entry]),
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
    // 工具必须经过下方已验证的Two Code权限扩展；不弹第二层重复审批。
    if (step) args.push("--approval-mode", "auto", "--non-interactive-approval", "deny");
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
      if (step) {
        const agentDir = join(configDir, "agent");
        await mkdir(agentDir, { recursive: true });
        connectionEnvironment = { STEP_CODING_AGENT_DIR: agentDir, STEPCODE_CONFIG_DIR: configDir };
      } else connectionEnvironment = { PI_CODING_AGENT_DIR: configDir };
    }
    // 开场门禁必须先于权限与派工桥；静默工具不能先执行再补说明。
    if (step) args.push("--extension", await writeStepOpeningExtension(input.sessionDir));
    {
      this.bridge = new ToolBridge(input);
      await this.bridge.start();
      const extension = join(input.sessionDir, "two-code-tools.mjs");
      await writeFile(extension, step ? stepToolExtension : piToolExtension, "utf8");
      args.push("--extension", extension);
      toolEnvironment = this.bridge.environment;
    }
    this.child = spawn(
      step
        ? entry
        : (input.connection?.subscription?.node ?? process.env.TWO_CODE_NODE ?? process.execPath),
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
          TWO_CODE_ACTOR_ROLE: input.role ?? "lead",
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
        new Error(
          `${this.label} 进程退出 (${code})${this.stderr ? `：${this.stderr.slice(-1500)}` : ""}`,
        ),
      ),
    );
  }
  private parse(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.fail(new Error(`${this.label} 协议行超过限制`));
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
          else pending.reject(new Error(String(record.error ?? `${this.label} 命令被拒绝`)));
        } else this.onRecord?.(record);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  private fail(error: Error): void {
    this.updateReady?.reject(error);
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
        reject(new Error(`${this.label} ${type} 未确认，不能假定已完成`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(JSON.stringify({ id, type, ...values }) + "\n", (error) => {
        if (error) this.fail(error);
      });
    });
  }
  async run(input: EngineRun): Promise<EngineReport> {
    this.runSignal = input.signal;
    input.signal.throwIfAborted();
    if (this.child) await this.close();
    this.updateReady = Promise.withResolvers<void>();
    void this.updateReady.promise.catch(() => {});
    await this.start(input).catch((error) => {
      this.updateReady?.reject(error);
      throw error;
    });
    const registered = await this.request("get_commands");
    if (
      this.harness === "step-code" &&
      (!Array.isArray(registered.commands) ||
        !registered.commands.some(
          (command: Json) =>
            command.name === "two-code-step-opening" &&
            command.description === "Two Code Step opening v1",
        ))
    )
      throw new Error("Step Code开场扩展未加载，拒绝启动模型任务");
    if (
      !Array.isArray(registered.commands) ||
      !registered.commands.some(
        (command: Json) =>
          command.name === "two-code-tool-bridge" &&
          command.description === "Two Code permission and sidekick bridge v1",
      )
    )
      throw new Error(`${this.label} 权限扩展未加载，拒绝启动模型任务`);
    const state = await this.request("get_state");
    const sessionId = typeof state.sessionFile === "string" ? state.sessionFile : input.sessionId;
    if (sessionId) await input.emit({ kind: "session", text: sessionId });
    const model = object(state.model);
    if (model.id) await input.emit({ kind: "model", text: `${model.provider ?? ""}/${model.id}` });
    let text = "",
      lastError: string | undefined;
    let openingFailure: string | undefined;
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
    let responseId = randomUUID();
    let resolveRun!: () => void, rejectRun!: (error: Error) => void;
    const settled = new Promise<void>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    void settled.catch(() => undefined);
    this.onFailure = rejectRun;
    this.onRecord = (record) => {
      if (record.type === "message_start" && object(record.message).role === "assistant") {
        responseId = randomUUID();
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
        const event = nativeDeltaEvent(delta, responseId);
        if (event) void input.emit(event).catch(rejectRun);
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
          .emit({
            kind: "tool",
            text: String(record.toolName ?? "工具执行"),
            toolCallId: String(record.toolCallId),
          })
          .catch(rejectRun);
      } else if (record.type === "tool_execution_end") {
        const start = tools.get(String(record.toolCallId));
        if (start) usage.toolMs += performance.now() - start;
        tools.delete(String(record.toolCallId));
        const blocked = rejectedToolEvent(record);
        if (blocked) {
          if (blocked.stopped) openingFailure = blocked.event.text;
          // SDK的start早于tool_call门禁；保存拒绝回执，不能把尝试显示成实际执行。
          void input.emit(blocked.event).catch(rejectRun);
        }
      } else if (record.type === "extension_ui_request") {
        void handleExtensionUi(record, input, this.label, (response) => {
          this.child?.stdin.write(JSON.stringify(response) + "\n");
        }).catch(rejectRun);
      } else if (record.type === "agent_settled") {
        if (openingFailure || lastError) rejectRun(new Error(openingFailure ?? lastError));
        else resolveRun();
      }
    };
    const abort = () => {
      void this.cancel();
      rejectRun(new Error(`${this.label} 任务已停止`));
    };
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const ack = await this.request("prompt", { message: input.prompt });
      if (ack.disposition === "handled")
        throw new Error(`${this.label} 处理了命令，但未启动模型任务`);
      this.updateReady.resolve();
      await settled;
      if (usage.steps) await input.usage?.({ ...usage });
      input.signal.throwIfAborted();
      if (!text) throw new Error(`${this.label} 已结束，但没有可读的最终回复`);
      const finalState = await this.request("get_state");
      return {
        text,
        sessionId: typeof finalState.sessionFile === "string" ? finalState.sessionFile : sessionId,
      };
    } finally {
      this.updateReady.reject(new Error(`${this.label} 本轮已结束`));
      input.signal.removeEventListener("abort", abort);
      this.onRecord = undefined;
      this.onFailure = undefined;
    }
  }
  async cancel(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    await this.request("abort").catch(() => undefined);
  }
  async update(message: string): Promise<void> {
    this.runSignal?.throwIfAborted();
    await this.updateReady?.promise;
    this.runSignal?.throwIfAborted();
    if (!this.onRecord || !this.child || this.child.exitCode !== null)
      throw new Error(`${this.label}已结束，更新未送达`);
    await this.request("steer", { message });
    if (!this.onRecord)
      throw new Error(`${this.label}恰好结束，更新未确认生效；请读取结果后重新交接`);
  }
  async close(): Promise<void> {
    this.updateReady?.reject(new Error(`${this.label} 会话已关闭`));
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
