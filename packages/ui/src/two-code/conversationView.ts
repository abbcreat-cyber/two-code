import { applyConversationDeltas } from "@zcode/shared/zcode-protocol-v4";
import type { TwoCodeViewFrame, TwoCodeViewSnapshot } from "@zcode/services";

/** null 表示断档，只向 Host 请求快照；不重放命令、不在 UI 猜测丢失的事实。 */
export function applyTwoCodeView(
  previous: TwoCodeViewSnapshot | undefined,
  frame: TwoCodeViewFrame,
  authoritative = false,
): TwoCodeViewSnapshot | null {
  if (frame.kind === "snapshot") {
    if (previous && previous.snapshot.logEpoch !== frame.snapshot.logEpoch && !authoritative)
      return null;
    if (
      previous?.snapshot.logEpoch === frame.snapshot.logEpoch &&
      previous.snapshot.revision >= frame.snapshot.revision
    )
      return previous;
    return frame;
  }
  if (!previous || previous.snapshot.logEpoch !== frame.epoch) return null;
  if (frame.revision <= previous.snapshot.revision) return previous;
  if (frame.fromRevision !== previous.snapshot.revision) return null;
  // 使用原前端同一 reducer：仅替换有变化的行，历史 Markdown 和工具行保持引用。
  const snapshot = applyConversationDeltas(previous.snapshot, frame.deltas);
  return {
    kind: "snapshot",
    task: frame.task ?? previous.task,
    snapshot: { ...snapshot, seq: frame.revision, revision: frame.revision },
  };
}
