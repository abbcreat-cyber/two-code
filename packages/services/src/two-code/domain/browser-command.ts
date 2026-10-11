import { browserCommandSchema, type BrowserCommand } from "@zcode/shared";
const methods = new Set([
  "navigate",
  "back",
  "forward",
  "reload",
  "snapshot",
  "click",
  "fill",
  "type",
  "press",
  "scroll",
  "hover",
  "select",
  "check",
  "screenshot",
  "getState",
  "newTab",
  "list",
  "close",
]);
export function parseTwoCodeBrowserCommand(command: unknown): BrowserCommand {
  const parsed = browserCommandSchema.parse(
    typeof command === "string" ? JSON.parse(command) : command,
  );
  // 不把Main内部生命周期或认领其他会话页的命令开放给模型。
  if (!methods.has(parsed.method)) throw Error("此内置浏览器操作尚未开放");
  return parsed;
}
export function browserCommandIsReadOnly(command: BrowserCommand): boolean {
  return ["snapshot", "getState", "list", "screenshot"].includes(command.method);
}
