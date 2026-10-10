import type { TwoCodeTask } from "../contract.js";
import { appendEvent } from "../domain/task.js";
import type { CoordinatorDependencies } from "./ports.js";

/** 恢复也属于写事务：只能在执行租约内重读后修改，不能信任启动扫描快照。 */
export async function recoverTask(
  deps: CoordinatorDependencies,
  candidate: TwoCodeTask,
  leaseHeld = false,
): Promise<TwoCodeTask> {
  if (candidate.status !== "running") return candidate;
  let release: (() => Promise<void>) | undefined;
  if (!leaseHeld && deps.lease) {
    if (await deps.lease.isActive(candidate.id)) return candidate;
    try {
      release = await deps.lease.acquire(candidate.id);
    } catch (cause) {
      // 检查与获取之间可能已有另一个窗口接手；其他租约错误仍向上传递。
      if (await deps.lease.isActive(candidate.id))
        return (await deps.store.read?.(candidate.id)) ?? candidate;
      throw cause;
    }
  }
  try {
    const latest = deps.store.read ? await deps.store.read(candidate.id) : candidate;
    if (!latest || latest.status !== "running") return latest ?? candidate;
    const task = structuredClone(latest);
    task.status = "error";
    task.error = "上次运行未正常结束。原生上下文保留，请核对已有产物后明确继续。";
    for (const role of ["lead", "sidekick"] as const)
      if (task[role].status === "running") task[role].status = "cancelled";
    task.permissions = [];
    // 只知道最后一次活动，不能把停机时间计入模型工作；保留事件让续聊历史不变成功。
    appendEvent(task, { role: "system", kind: "error", text: task.error }, task.updatedAt);
    await deps.store.save(task);
    return task;
  } finally {
    await release?.();
  }
}
