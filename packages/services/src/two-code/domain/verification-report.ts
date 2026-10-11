import type { TwoCodeTask } from "../contract.js";

/** 只引用当前交接内实际发生的原生回执，不能用上一轮成功替当前轮背书。 */
export function verificationReport(task: TwoCodeTask): string {
  const start = task.events.findLast((e) => e.kind === "handoff")?.seq;
  if (start === undefined) return "";
  const all = task.events.filter(
    (e) => e.seq > start && e.role === "sidekick" && e.kind === "verification",
  );
  const receipts = all.slice(-8);
  if (!receipts.length) return "";
  return `原生执行回执（执行器实际返回，非副手自述；本交接${all.length}条${all.length > 8 ? "，仅显示最近8条" : ""}）：\n${receipts.map((e) => e.text).join("\n")}\n回执仅证明对应工具执行结果；仍须按用户要求核对关键产物，已成功且输入未变的测试不重复运行。\n\n`;
}
