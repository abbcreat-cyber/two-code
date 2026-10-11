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
    const pendingLeadPermissions = task.permissions
      .filter((p) => p.role === "lead")
      .map((p) => p.id);
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
      // steer先进入原生队列，再拒绝旧工具；否则旧工具恢复时可能尚未看到新要求。
      // 仅撤回准入前的主手请求，不能误删更新之后或副手正在等待的新权限。
      const withdrawn = pendingLeadPermissions.filter((id) => run.permissions.has(id));
      if (withdrawn.length) {
        const ids = new Set(withdrawn);
        task.permissions = task.permissions.filter((p) => !ids.has(p.id));
        for (const id of withdrawn) {
          run.permissions.get(id)?.(false);
          run.permissions.delete(id);
        }
        owner.emit({
          role: "system",
          kind: "status",
          text: "已撤回主手待确认操作，优先处理补充要求",
        });
        await owner.save();
        owner.current();
      }
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
