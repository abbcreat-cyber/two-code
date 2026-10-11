import type { TwoCodePreferences } from "@zcode/services";
type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readDraftPreferences(
  store: DraftStore,
  key: string,
  fallback: TwoCodePreferences,
): TwoCodePreferences {
  try {
    const value = JSON.parse(store.getItem(key) ?? "null");
    if (
      value &&
      typeof value.dual === "boolean" &&
      (value.mode === undefined || ["plan", "build", "edit", "yolo"].includes(value.mode)) &&
      [value.lead, value.sidekick].every(
        (role) =>
          role &&
          ["pi", "claude-code", "zcode", "step-code"].includes(role.harness) &&
          [role.provider, role.model, role.modelLabel, role.thinking].every(
            (field) => field === undefined || (typeof field === "string" && field.length <= 300),
          ),
      )
    )
      return value;
  } catch {
    /* 草稿缓存不是服务事实，损坏时回到已保存的默认值。 */
  }
  return fallback;
}
export function saveDraftPreferences(store: DraftStore, key: string, value: TwoCodePreferences) {
  store.setItem(key, JSON.stringify(value));
}
export function clearSubmittedDraftPreferences(
  store: DraftStore,
  key: string,
  submitted: TwoCodePreferences,
) {
  // 只清除刚提交的配置，异步提交期间编辑的新草稿不得被迟到响应删除。
  if (store.getItem(key) === JSON.stringify(submitted)) store.removeItem(key);
}
