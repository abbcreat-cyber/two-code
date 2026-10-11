import type { TwoCodeTask } from "../contract.js";
import type { ActiveRun } from "./active-run.js";
import type { CoordinatorDependencies } from "./ports.js";

/** Coordinator的收尾事务；终态副本提交后由调用方同步发布，期间不提前开放续问。 */
export async function settleRun(
  deps: CoordinatorDependencies,
  task: TwoCodeTask,
  run: ActiveRun,
  outcome: TwoCodeTask["status"],
  failure?: string,
): Promise<Pick<TwoCodeTask, "status" | "error">> {
  for (const resolve of run.permissions.values()) resolve(false);
  run.permissions.clear();
  task.permissions = [];
  await Promise.allSettled([...run.actors.values()].map((adapter) => adapter.close()));
  for (const role of ["lead", "sidekick"] as const)
    if (task[role].status === "running") task[role].status = "cancelled";
  if (run.abort.signal.aborted && !failure) outcome = "cancelled";
  if (run.steeringError) {
    outcome = "error";
    failure = run.steeringError;
  }
  run.committing = true;
  const finished = { ...structuredClone(task), status: outcome, error: failure };
  try {
    await deps.store.save(finished);
  } catch (error) {
    finished.status = "error";
    finished.error = `执行状态未能保存，请勿重复运行：${String(error)}`;
  }
  try {
    await run.release?.();
  } catch (error) {
    finished.status = "error";
    finished.error = `执行租约未能释放：${String(error)}`;
    await deps.store.save(finished).catch(() => undefined);
  }
  return { status: finished.status, error: finished.error };
}
