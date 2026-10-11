import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Emitter } from "@zcode/rpc";
import type {
  ActorRole,
  CreateTwoCodeTask,
  ITwoCodeExecutionService,
  TaskEvent,
  TwoCodeTask,
  TwoCodePreferences,
} from "../contract.js";
import type { CoordinatorDependencies, EngineReport } from "./ports.js";
import type { ActiveRun } from "./active-run.js";
import { parsePreferences } from "../domain/snapshot.js";
import { permissionDecision } from "./permission-policy.js";
import { admitTask } from "./admission.js";
import { recoverTask } from "./recovery.js";
import {
  appendEvent,
  leadInstruction,
  newTask,
  reconfigureTask,
  sidekickInstruction,
  sidekickPrompt,
  validateSelection,
} from "../domain/task.js";

const copy = (task: TwoCodeTask): TwoCodeTask => structuredClone(task);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class TwoCodeCoordinator implements ITwoCodeExecutionService {
  private readonly tasks = new Map<string, TwoCodeTask>();
  private readonly active = new Map<string, ActiveRun>();
  private readonly configuring = new Set<string>();
  private readonly changes = new Emitter<TwoCodeTask>();
  private readonly ready: Promise<void>;
  readonly onDidChange = this.changes.event;
  constructor(private readonly deps: CoordinatorDependencies) {
    this.ready = this.restore();
  }
  private async restore(): Promise<void> {
    for (const saved of await this.deps.store.load()) {
      const task = await recoverTask(this.deps, saved);
      this.tasks.set(task.id, task);
      this.changes.fire(copy(task));
    }
  }
  private async task(id: string, leaseHeld = false): Promise<TwoCodeTask> {
    await this.ready;
    const canRefresh = () => !this.active.has(id) && (!this.configuring.has(id) || leaseHeld);
    if (canRefresh() && this.deps.store.read) {
      const latest = await this.deps.store.read(id);
      if (latest && canRefresh()) {
        const recovered = await recoverTask(this.deps, latest, leaseHeld);
        if (canRefresh()) {
          this.tasks.set(id, recovered);
          if (recovered !== latest) this.changes.fire(copy(recovered));
        }
      }
    }
    const task = this.tasks.get(id);
    if (!task) throw new Error("任务不存在");
    return task;
  }
  private emit(task: TwoCodeTask, role: TaskEvent["role"], kind: TaskEvent["kind"], text: string) {
    appendEvent(task, { role, kind, text }, new Date().toISOString());
    this.changes.fire(copy(task));
  }
  catalog = () => this.deps.catalog();
  preferences = async (): Promise<TwoCodePreferences> =>
    this.deps.preferences?.read() ?? {
      dual: true,
      lead: { harness: "claude-code" },
      sidekick: { harness: "pi" },
    };
  async configurePreferences(input: TwoCodePreferences): Promise<TwoCodePreferences> {
    input = parsePreferences(input);
    validateSelection(input.lead);
    validateSelection(input.sidekick);
    if (typeof input.dual !== "boolean" || !this.deps.preferences) throw new Error("配置不可保存");
    await this.deps.preferences.write(input);
    return structuredClone(input);
  }
  async list(workspacePath: string): Promise<TwoCodeTask[]> {
    await this.ready;
    for (const latest of await this.deps.store.load()) {
      if (this.active.has(latest.id) || this.configuring.has(latest.id)) continue;
      const recovered = await recoverTask(this.deps, latest);
      if (this.active.has(latest.id) || this.configuring.has(latest.id)) continue;
      this.tasks.set(latest.id, recovered);
      if (recovered !== latest) this.changes.fire(copy(recovered));
    }
    const canonical = await this.deps.validateWorkspace(workspacePath);
    return [...this.tasks.values()]
      .filter((task) => task.workspacePath === canonical)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(copy);
  }
  async create(input: CreateTwoCodeTask): Promise<TwoCodeTask> {
    await this.ready;
    const workspacePath = await this.deps.validateWorkspace(input.workspacePath);
    const task = newTask(
      randomUUID(),
      { ...input, ...parsePreferences(input), workspacePath },
      new Date().toISOString(),
    );
    await this.deps.store.save(task);
    this.tasks.set(task.id, task);
    this.changes.fire(copy(task));
    return copy(task);
  }
  read = async (id: string) => copy(await this.task(id));
  async configure(input: {
    taskId: string;
    preferences: TwoCodePreferences;
  }): Promise<TwoCodeTask> {
    await this.ready;
    const id = input.taskId;
    const preferences = parsePreferences(input.preferences);
    if (this.active.has(id) || this.configuring.has(id))
      throw new Error("任务执行或配置保存中，请稍后更换");
    this.configuring.add(id);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.deps.lease?.acquire(id);
      const task = await this.task(id, true);
      const next = reconfigureTask(task, preferences);
      await this.deps.store.save(next);
      this.tasks.set(id, next);
      this.changes.fire(copy(next));
      return copy(next);
    } finally {
      await release?.();
      this.configuring.delete(id);
    }
  }
  async submit(input: { taskId: string; requestId: string; text: string }): Promise<TwoCodeTask> {
    const task = await this.task(input.taskId);
    if (this.configuring.has(task.id)) throw new Error("模型配置保存中，请稍后发送");
    if (!input.requestId || input.requestId.length > 200 || !input.text?.trim()) {
      throw new Error("请求编号和任务内容不能为空");
    }
    const existing = this.active.get(task.id);
    if (task.requestIds.includes(input.requestId) || existing?.requestId === input.requestId) {
      await existing?.admission;
      return copy(task);
    }
    if (existing) throw new Error("当前任务仍在执行，请等待或先停止");
    // 接收锁在首次await前建立，避免同任务并发输入启动两套执行。
    const run: ActiveRun = {
      id: randomUUID(),
      requestId: input.requestId,
      abort: new AbortController(),
      actors: new Map(),
      permissions: new Map(),
    };
    this.active.set(task.id, run);
    run.admission = admitTask(
      this.deps,
      task,
      run,
      input.text,
      () => this.current(task, run),
      () => this.changes.fire(copy(task)),
    );
    try {
      await run.admission;
    } catch (error) {
      this.active.delete(task.id);
      await run.release?.();
      this.changes.fire(copy(task));
      throw error;
    }
    if (run.duplicate || run.abort.signal.aborted) {
      this.active.delete(task.id);
      await run.release?.();
      return copy(task);
    }
    run.work = this.runLead(task, run, input.text);
    return copy(task);
  }
  private current(task: TwoCodeTask, run: ActiveRun): void {
    if (run.abort.signal.aborted || this.active.get(task.id) !== run) {
      throw new Error("任务已停止，原生会话上下文保留");
    }
  }
  private async requestPermission(
    task: TwoCodeTask,
    run: ActiveRun,
    role: ActorRole,
    title: string,
    detail: string,
  ) {
    this.current(task, run);
    const decision = await permissionDecision(
      task.mode ?? "build",
      title,
      detail,
      task.workspacePath,
    );
    this.current(task, run);
    if (decision !== "ask") return decision === "allow";
    const id = randomUUID();
    const answer = new Promise<boolean>((resolve) => run.permissions.set(id, resolve));
    task.permissions.push({ id, role, title, detail });
    this.changes.fire(copy(task));
    return answer;
  }
  async respond(input: { taskId: string; permissionId: string; allow: boolean }): Promise<void> {
    const task = await this.task(input.taskId);
    const run = this.active.get(task.id);
    const resolve = run?.permissions.get(input.permissionId);
    if (!run || !resolve || typeof input.allow !== "boolean") throw new Error("权限请求已失效");
    run.permissions.delete(input.permissionId);
    task.permissions = task.permissions.filter((request) => request.id !== input.permissionId);
    resolve(input.allow);
    this.changes.fire(copy(task));
  }
  private async execute(
    task: TwoCodeTask,
    run: ActiveRun,
    role: ActorRole,
    prompt: string,
  ): Promise<EngineReport> {
    this.current(task, run);
    const actor = task[role];
    let adapter = run.actors.get(role);
    if (!adapter) {
      adapter = this.deps.createAdapter(actor.selection.harness);
      run.actors.set(role, adapter);
    }
    actor.status = "running";
    this.emit(task, role, "status", "开始执行");
    try {
      const usageId = randomUUID();
      const report = await adapter.run({
        connection: run.connections?.[role],
        mode: task.mode ?? "build",
        usage: async (usage) => {
          this.current(task, run);
          // 每次适配器运行回执替换同一记录；不能把累计回执重复相加。
          task.usage = [
            ...(task.usage ?? []).filter((item) => item.id !== usageId),
            { ...usage, id: usageId, role },
          ];
          await this.deps.store.save(task);
          this.changes.fire(copy(task));
        },
        cwd: task.workspacePath,
        sessionDir: join(this.deps.sessionRoot, task.id, role),
        selection: actor.selection,
        sessionId: actor.sessionId,
        prompt,
        systemPrompt:
          (role === "sidekick"
            ? sidekickInstruction
            : task.dual
              ? leadInstruction
              : "所有面向用户的输出一律中文。核对真实证据后汇报。") +
          `\n本次真实工作目录：${task.workspacePath}。主副手共享此目录；此目录中的绝对路径与相对路径指向同一工作区，不需为确认目录另执行命令。`,
        signal: run.abort.signal,
        emit: async (event) => {
          if (run.abort.signal.aborted || this.active.get(task.id) !== run) return;
          if (event.kind === "session") {
            actor.sessionId = event.text;
            await this.deps.store.save(task);
            this.changes.fire(copy(task));
          } else if (event.kind === "model") actor.actualModel = event.text;
          else this.emit(task, role, event.kind, event.text);
        },
        permission: (title, detail) => this.requestPermission(task, run, role, title, detail),
        ...(role === "lead" && task.dual
          ? {
              handoff: (message: string, block = true) => this.handoff(task, run, message, block),
              readSidekick: () => this.sidekickResult(task, run),
            }
          : {}),
      });
      this.current(task, run);
      actor.sessionId = report.sessionId ?? actor.sessionId;
      actor.lastReport = report.text;
      actor.status = "completed";
      this.emit(task, role, "status", "执行已结束，待核对结果");
      await this.deps.store.save(task);
      return report;
    } catch (error) {
      actor.status = run.abort.signal.aborted ? "cancelled" : "error";
      throw error;
    }
  }
  private async handoff(
    task: TwoCodeTask,
    run: ActiveRun,
    message: string,
    block: boolean,
  ): Promise<string> {
    this.current(task, run);
    if (typeof message !== "string" || !message.trim()) throw new Error("副手任务不能为空");
    if (run.sidekick && task.sidekick.status === "running") {
      throw new Error("副手仍在执行，请先read_sidekick读取报告；不要重复派工");
    }
    this.emit(task, "lead", "handoff", message);
    run.sidekickRead = false;
    run.sidekick = this.execute(task, run, "sidekick", sidekickPrompt(task, message)).then(
      (report) => report.text,
    );
    // 非阻塞派工也必须有人观察失败；read_sidekick仍保留原拒绝语义。
    void run.sidekick.catch(() => undefined);
    return block
      ? this.sidekickResult(task, run)
      : "派工已接受，尚未完成。请在结束前调用read_sidekick。";
  }
  private async sidekickResult(task: TwoCodeTask, run: ActiveRun): Promise<string> {
    this.current(task, run);
    if (!run.sidekick) throw new Error("本轮尚未派工");
    const pending = run.sidekick;
    const report = await pending;
    this.current(task, run);
    // 只有真正返回给主手的当前报告才算已读；旧调用迟到不能确认新派工。
    if (run.sidekick === pending) run.sidekickRead = true;
    return `${report}\n\n主手须核对原始要求和产物；执行结束不等于验收通过。`;
  }
  private async runLead(task: TwoCodeTask, run: ActiveRun, prompt: string): Promise<void> {
    try {
      await this.execute(task, run, "lead", prompt);
      if (run.sidekick && task.sidekick.status === "running") {
        throw new Error("主手结束时副手仍在执行，尚未形成已审查结果");
      }
      if (run.sidekick && task.sidekick.status === "error") {
        throw new Error("副手执行失败，本轮未完成；请检查副手结果后重试");
      }
      if (run.sidekick && !run.sidekickRead) {
        throw new Error("主手尚未调用read_sidekick取得副手报告，本轮未完成");
      }
      this.current(task, run);
      task.status = "completed";
    } catch (error) {
      task.status = run.abort.signal.aborted ? "cancelled" : "error";
      // 主动停止已有取消事件，不能把适配器的abort异常当作运行失败回传到界面。
      task.error = task.status === "cancelled" ? undefined : errorText(error);
      if (task.error) this.emit(task, "system", "error", task.error);
      run.abort.abort();
    } finally {
      for (const resolve of run.permissions.values()) resolve(false);
      run.permissions.clear();
      task.permissions = [];
      await Promise.allSettled([...run.actors.values()].map((adapter) => adapter.close()));
      for (const role of ["lead", "sidekick"] as const) {
        if (task[role].status === "running") task[role].status = "cancelled";
      }
      try {
        await this.deps.store.save(task);
      } catch (error) {
        task.status = "error";
        task.error = `执行状态未能保存，请勿重复运行：${errorText(error)}`;
      }
      if (this.active.get(task.id) === run) this.active.delete(task.id);
      await run.release?.();
      this.changes.fire(copy(task));
    }
  }
  async cancel(id: string): Promise<TwoCodeTask> {
    const task = await this.task(id);
    const run = this.active.get(id);
    if (!run) {
      if (task.status === "running") throw new Error("此任务正在另一窗口执行，请在原窗口停止");
      return copy(task);
    }
    run.abort.abort();
    for (const resolve of run.permissions.values()) resolve(false);
    run.permissions.clear();
    task.permissions = [];
    // 启动阶段由准入事务在读完最新快照后写取消；提前改内存会被迟到读取覆盖。
    if (run.work) {
      task.status = "cancelled";
      this.emit(task, "system", "status", "正在停止主手与副手");
    }
    await run.admission?.catch(() => undefined);
    await Promise.allSettled([...run.actors.values()].map((adapter) => adapter.cancel()));
    await run.work;
    return copy(task);
  }
  async dispose(): Promise<void> {
    await this.ready;
    await Promise.allSettled([...this.active.keys()].map((id) => this.cancel(id)));
    this.changes.dispose();
  }
}
