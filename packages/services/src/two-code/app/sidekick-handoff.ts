import type { TwoCodeTask, TaskEvent } from "../contract.js";
import type { ActiveRun } from "./active-run.js";
import type { EngineReport } from "./ports.js";
import { sidekickPrompt } from "../domain/task.js";
import { reviewReportNote, interruptionEvidenceNote } from "../domain/handoffs.js";
import { verificationReport } from "../domain/verification-report.js";
import { failUpdate } from "./update-failure.js";

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
  if (!run.sidekick) {
    // 新轮不能继承旧pending，也不能把旧报告冒充新结果；读状态应给出可恢复的历史入口。
    const last = task.events.findLast((e) => e.role === "lead" && e.kind === "handoff");
    if (!last)
      return "状态说明，非副手报告：本轮尚未派工，没有本轮副手报告；尚无历史派工。需要副手执行时先调用sidekick。";
    const events = task.events.filter((e) => e.seq > last.seq && e.role === "sidekick");
    const reported = events.some((e) => e.kind === "handoff_report");
    const receipts = events.filter((e) => e.kind === "verification").length;
    return `状态说明，非副手报告：本轮尚未派工，没有本轮副手报告。最近一次历史派工#${last.seq}${reported ? "已收到最终报告" : "未取得最终报告，不能视为完成"}，保留${receipts}条原生执行回执。请调用read_handoff_history读取派工、回执及历史报告；需要新执行时再向同一sidekick明确派工，不为确认已有结果自动重跑。`;
  }
  const pending = run.sidekick;
  const report = await Promise.race([
    pending.then((text) => ({ text })),
    ...(run.leadWake ? [run.leadWake.promise.then(() => null)] : []),
  ]);
  current();
  if (!report)
    return "用户有新的补充，尚未取得副手最终报告。先处理补充要求；需要改向时向同一sidekick提交更新，不要重复执行已有工作，之后再read_sidekick。";
  if (run.sidekick === pending) run.sidekickRead = true;
  const updated =
    task.events.findLast((e) => e.kind === "handoff" || e.kind === "handoff_update")?.kind ===
    "handoff_update";
  return `${verificationReport(task)}副手报告：\n${report.text}\n\n${reviewReportNote}${updated ? interruptionEvidenceNote : ""}`;
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
    try {
      await adapter.update(sidekickPrompt(task, message, true));
      owner.current();
      owner.emit("handoff_update", message, userSeq);
      await owner.save();
    } catch (error) {
      // 工具异常可能被主手捕获；任务级失败必须由协调器保留，不能读旧报告后变成功。
      await failUpdate(run, "副手补充", error, {
        emit: (event) => owner.emit(event.kind, event.text),
        save: owner.save,
      });
    }
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
