import type { ConversationDelta, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import type { TwoCodeTask } from "./task-types.js";
import type { Event } from "@zcode/rpc";
export interface TwoCodeViewsApi {
  onDidViewChange: Event<TwoCodeViewFrame>;
  readView(taskId: string): Promise<TwoCodeViewSnapshot>;
  listViews(workspacePath: string): Promise<TwoCodeViewSnapshot[]>;
}

/** 控制面视图，events 不含正文/思考/工具参数碎片；原始历史使用 read/list。 */
export type TwoCodeTaskView = TwoCodeTask;
export interface TwoCodeViewSnapshot {
  kind: "snapshot";
  task: TwoCodeTaskView;
  snapshot: ConversationSnapshot;
}
export type TwoCodeViewFrame =
  | TwoCodeViewSnapshot
  | {
      kind: "delta";
      taskId: string;
      workspacePath: string;
      epoch: string;
      fromRevision: number;
      revision: number;
      task?: TwoCodeTaskView;
      deltas: ConversationDelta[];
    };
