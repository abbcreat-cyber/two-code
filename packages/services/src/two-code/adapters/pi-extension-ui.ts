import type { EngineRun } from "../app/ports.js";

/** Pi/Step 的同名 UI 事件包含单向通知，不能全部当作工具批准。 */
export async function handleExtensionUi(
  record: Record<string, unknown>,
  input: Pick<EngineRun, "permission" | "emit">,
  label: string,
  respond: (response: Record<string, unknown>) => void,
): Promise<void> {
  const method = String(record.method ?? "");
  if (["setStatus", "setWidget", "setTitle", "set_editor_text"].includes(method)) return;
  if (method === "notify") {
    if (typeof record.message === "string" && record.message)
      await input.emit({ kind: "message", text: `\n${label}：${record.message}\n` });
    return;
  }
  if (typeof record.id !== "string" || !record.id) throw new Error(`${label} 交互请求缺少ID`);
  if (method === "confirm") {
    const confirmed = await input.permission(
      String(record.title ?? `${label} 请求`),
      String(record.message ?? "确认"),
    );
    respond({ type: "extension_ui_response", id: record.id, confirmed });
    return;
  }
  // 文本/选择题要求value；布尔权限答案不是用户输入，必须显式拒绝而非假装已完成。
  respond({ type: "extension_ui_response", id: record.id, cancelled: true });
  throw new Error(`${label} 暂不支持 ${method || "未知"} 交互，请在聊天中补充要求后继续`);
}
