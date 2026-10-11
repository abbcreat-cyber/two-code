import type { TwoCodeTask, TaskEvent } from "../contract.js";
import type { ActiveRun } from "./active-run.js";
import type { EngineReport } from "./ports.js";
import { sidekickPrompt } from "../domain/task.js";
import { reviewReportNote } from "../domain/handoffs.js";

export function wakeChannel() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface HandoffOwner {
  current(): void;
  emit(kind: TaskEvent["kind"], text: string, userSeq?: number): void;
  execute(prompt: string): Promise<EngineReport>;
  save(): Promise<void>;
}

export async function readSidekick(
  task: TwoCodeTask,
  run: ActiveRun,
  current: () => void,
): Promise<string> {
  current();
  if (!run.sidekick) throw new Error("本轮尚未派工");
  const pending = run.sidekick;
  const report = await Promise.race([
    pending.then((text) => ({ text })),
    ...(run.leadWake ? [run.leadWake.promise.then(() => null)] : []),
  ]);
  current();
  if (!report)
    return "用户有新的补充，尚未取得副手最终报告。先处理补充要求；需要改向时向同一sidekick提交更新，不要重复执行已有工作，之后再read_sidekick。";
  if (run.sidekick === pending) run.sidekickRead = true;
  return `${report.text}\n\n${reviewReportNote}`;
}

export async function handoff(
  task: TwoCodeTask,
  run: ActiveRun,
  message: string,
  block: boolean,
  owner: HandoffOwner,
): Promise<string> {
  owner.current();
  if (typeof message !== "string" || !message.trim()) throw new Error("副手任务不能为空");
  const userSeq = task.events.findLast((e) => e.role === "user" && e.kind === "message")?.seq;
  if (run.sidekick && task.sidekick.status === "running") {
    const adapter = run.actors.get("sidekick");
    if (!adapter?.update)
      throw new Error("该底座暂不支持运行中更新；请读取现有报告，不要假定补充已送达");
    // 原交接的批准不能移到更新后的操作；取消旧权限等待，仍由owner处理下一次工具请求。
    for (const request of task.permissions.filter((p) => p.role === "sidekick")) {
      run.permissions.get(request.id)?.(false);
      run.permissions.delete(request.id);
    }
    task.permissions = task.permissions.filter((p) => p.role !== "sidekick");
    run.sidekickRead = false;
    await adapter.update(sidekickPrompt(task, message, true));
    owner.current();
    owner.emit("handoff_update", message, userSeq);
    await owner.save();
    return block
      ? readSidekick(task, run, owner.current)
      : "更新已提交给原副手，尚未取得完成报告；请read_sidekick等待。";
  }
  owner.emit("handoff", message, userSeq);
  run.sidekickRead = false;
  run.sidekick = owner.execute(sidekickPrompt(task, message)).then((report) => report.text);
  void run.sidekick.catch(() => undefined);
  return block
    ? readSidekick(task, run, owner.current)
    : "派工已接受，尚未完成。请在结束前调用read_sidekick。";
}
