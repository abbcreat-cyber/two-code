import type { TwoCodeTask, TaskEvent } from "../contract.js";
import type { ActiveRun } from "./active-run.js";
import { wakeChannel } from "./sidekick-handoff.js";

export function steerRun(
  task: TwoCodeTask,
  run: ActiveRun,
  input: { requestId: string; text: string },
  owner: {
    current(): void;
    save(): Promise<void>;
    emit(event: Omit<TaskEvent, "seq" | "at">): void;
  },
): Promise<void> {
  const previous = run.updateAdmissions?.get(input.requestId);
  if (previous) return previous;
  run.updateAdmissions ??= new Map();
  const work = (run.steering ?? Promise.resolve()).then(async () => {
    owner.current();
    if (task.requestIds.includes(input.requestId)) return;
    const adapter = run.actors.get("lead");
    if (!adapter?.update || task.lead.status !== "running")
      throw new Error("主手当前不能接收运行中补充，请等本轮结束后发送");
    owner.emit({
      role: "user",
      kind: "message",
      text: input.text,
      continuation: true,
      requestId: input.requestId,
    });
    task.requestIds.push(input.requestId);
    await owner.save();
    try {
      owner.current();
      await adapter.update(
        `用户补充（优先判断并处理，不重做已经完成的工作）：\n${input.text}\n如影响正在执行的副手，请向同一个sidekick提交lead_update；如用户等待一个即时结果，先要求副手报告现有成果，勿直接恢复长等待。`,
      );
      owner.current();
      const wake = run.leadWake;
      run.leadWake = wakeChannel();
      wake?.resolve();
    } catch (error) {
      if (run.abort.signal.aborted) throw new Error("任务已停止，补充未执行");
      // 传输结果不明时停止旧计划，避免继续执行与新要求冲突的动作或重复投递。
      run.steeringError = `用户补充未确认送达：${String(error)}`;
      owner.emit({
        role: "system",
        kind: "error",
        text: run.steeringError,
        requestId: input.requestId,
        deliveryFailed: true,
      });
      await owner.save();
      run.abort.abort();
      throw new Error(run.steeringError);
    }
  });
  run.steering = work.catch(() => undefined);
  run.updateAdmissions.set(input.requestId, work);
  return work;
}
