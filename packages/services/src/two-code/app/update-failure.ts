import type { TaskEvent } from "../contract.js";
import type { ActiveRun } from "./active-run.js";

/** 更新结果不明时先停止旧计划，不能等待磁盘恢复或允许旧报告冒充新结果。 */
export async function failUpdate(
  run: ActiveRun,
  label: string,
  error: unknown,
  owner: { emit(event: Omit<TaskEvent, "seq" | "at">): void; save(): Promise<void> },
  requestId?: string,
): Promise<never> {
  if (run.abort.signal.aborted) throw new Error("任务已停止，补充未执行");
  run.steeringError = `${label}未确认送达：${String(error)}`;
  owner.emit({
    role: "system",
    kind: "error",
    text: run.steeringError,
    ...(requestId ? { requestId, deliveryFailed: true } : {}),
  });
  run.abort.abort();
  try {
    await owner.save();
  } catch (cause) {
    run.steeringError += `；错误状态保存失败：${String(cause)}`;
  }
  throw new Error(run.steeringError);
}
