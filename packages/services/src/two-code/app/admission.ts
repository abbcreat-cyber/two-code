import type { TwoCodeTask } from "../contract.js";
import { normalizeTaskThinking } from "../domain/thinking.js";
import { appendEvent } from "../domain/task.js";
import type { ActiveRun } from "./active-run.js";
import type { CoordinatorDependencies } from "./ports.js";

/** Coordinator的启动事务：持有租约后保存准入或取消，晚到配置不得恢复执行。 */
export async function admitTask(
  deps: CoordinatorDependencies,
  task: TwoCodeTask,
  run: ActiveRun,
  text: string,
  current: () => void,
  changed: () => void,
): Promise<void> {
  let snapshotReady = false;
  const recordRequest = () => {
    if (task.requestIds.includes(run.requestId)) return;
    task.requestIds.push(run.requestId);
    if (task.title === "新任务") task.title = text.trim().slice(0, 50);
    appendEvent(task, { role: "user", kind: "message", text }, new Date().toISOString());
  };
  try {
    run.release = await deps.lease?.acquire(task.id);
    const latest = await deps.store.read?.(task.id);
    if (latest) Object.assign(task, latest);
    snapshotReady = true;
    if (task.requestIds.includes(run.requestId)) {
      run.duplicate = true;
      return;
    }
    current();
    run.connections = await deps.connections?.(task);
    current();
    const catalog = await deps.catalog();
    current();
    const previous = structuredClone(task);
    normalizeTaskThinking(task, catalog);
    recordRequest();
    task.error = undefined;
    task.status = "running";
    try {
      await deps.store.save(task);
    } catch (error) {
      Object.assign(task, previous);
      throw error;
    }
    current();
  } catch (error) {
    // 未取得租约时绝不能覆盖另一窗口；用户取消与真正的保存失败分别处理。
    if (!run.abort.signal.aborted || !snapshotReady || (deps.lease && !run.release)) throw error;
    recordRequest();
    task.status = "cancelled";
    task.error = undefined;
    task.permissions = [];
    appendEvent(
      task,
      { role: "system", kind: "status", text: "正在停止主手与副手" },
      new Date().toISOString(),
    );
    try {
      await deps.store.save(task);
    } catch (cause) {
      task.status = "error";
      task.error = "取消状态未能保存，请核对任务状态后再继续";
      throw cause;
    }
  }
  changed();
}
