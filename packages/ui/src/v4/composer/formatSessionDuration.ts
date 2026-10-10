export function formatSessionDuration(ms: number | null, zh: boolean): string {
  if (ms === null) return "—";
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}${zh ? "秒" : "s"}`;
  // 先对总秒数取整再拆分钟，避免余秒四舍五入后显示“1分60秒”。
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}${zh ? "分" : "m "}${seconds % 60}${zh ? "秒" : "s"}`;
}
