import { Emitter } from "@zcode/rpc";
import type { TwoCodeTask } from "../contract.js";
import { ConversationViews } from "./conversation-views.js";
import { TaskSnapshotPublisher } from "./task-snapshot-publisher.js";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export class TaskNotifications {
  readonly views = new ConversationViews();
  private legacyObserved = false;
  private readonly legacy = new Emitter<TwoCodeTask>({
    onWillAddFirstListener: () => {
      this.legacyObserved = true;
    },
    onDidRemoveLastListener: () => {
      this.legacyObserved = false;
    },
  });
  readonly onDidChange = this.legacy.event;
  private readonly publisher = new TaskSnapshotPublisher(
    (task) => {
      this.views.update(task);
      // 兼容旧消费者；原前端已走标准行增量，无旧订阅时不再拷贝完整事件历史。
      if (this.legacyObserved) this.legacy.fire(structuredClone(task));
    },
    100,
    (task) => task,
  );
  publish(task: TwoCodeTask, streaming = false): void {
    this.publisher.publish(task, streaming);
  }
  dispose(): void {
    this.publisher.dispose();
    this.views.dispose();
    this.legacy.dispose();
  }
}
