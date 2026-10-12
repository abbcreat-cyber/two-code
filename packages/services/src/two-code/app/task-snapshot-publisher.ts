import type { TwoCodeTask } from "../contract.js";

/** 仅合并派生快照；原始事件仍在 Coordinator 逐条接收并持久化。 */
export class TaskSnapshotPublisher {
  private pending = new Map<string, { task: TwoCodeTask; timer: ReturnType<typeof setTimeout> }>();
  private lastStreamAt = new Map<string, number>();
  constructor(
    private readonly deliver: (snapshot: TwoCodeTask) => void,
    private readonly intervalMs = 100,
    private readonly freeze: (task: TwoCodeTask) => TwoCodeTask = structuredClone,
  ) {}

  publish(task: TwoCodeTask, streaming = false): void {
    if (!streaming) {
      this.clear(task.id);
      this.lastStreamAt.delete(task.id);
      this.deliver(this.freeze(task));
      return;
    }
    const elapsed = Date.now() - (this.lastStreamAt.get(task.id) ?? -Infinity);
    if (elapsed >= this.intervalMs) {
      this.clear(task.id);
      this.lastStreamAt.set(task.id, Date.now());
      this.deliver(this.freeze(task));
      return;
    }
    const pending = this.pending.get(task.id);
    if (pending) {
      pending.task = task;
      return;
    }
    // 每 token 深拷贝会随历史增长形成平方级分配；直到发送时才冻结一份完整快照。
    const timer = setTimeout(() => {
      const latest = this.pending.get(task.id);
      this.pending.delete(task.id);
      if (!latest) return;
      this.lastStreamAt.set(task.id, Date.now());
      this.deliver(this.freeze(latest.task));
    }, this.intervalMs - elapsed);
    this.pending.set(task.id, { task, timer });
  }

  private clear(id: string): void {
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(id);
  }

  dispose(): void {
    for (const id of this.pending.keys()) this.clear(id);
    this.lastStreamAt.clear();
  }
}
