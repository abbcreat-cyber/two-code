import type { TwoCodeTask } from "../contract.js";

export function handoffEnvelope(message: string, update = false): string {
  const body = message.replace(
    /^\s*<lead_(?:handoff|update)>\s*([\s\S]*?)\s*<\/lead_(?:handoff|update)>\s*$/,
    "$1",
  );
  return update
    ? `The lead sent an update for the handoff you are working on. Fold it in and continue (or wind down, if that is what it asks):\n\n<lead_update>\n${body}\n</lead_update>\n\n${interruptionEvidenceNote}`
    : `<lead_handoff>\n${body}\n</lead_handoff>\n\nWork it to completion, then report what you did, the evidence (diffs, test output and artifact paths), deviations, and anything you need from the lead. Reuse earlier results; do not repeat unchanged checks.`;
}

/** 原始事件就是账本；分页不生成第二份摘要，跨原生压缩仍能逐字恢复。 */
export function handoffHistory(task: TwoCodeTask, offset = 0): string {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("交接历史位置无效");
  const text = JSON.stringify(
    task.events
      .filter((e) => ["handoff", "handoff_update", "handoff_report"].includes(e.kind))
      .map((e) => ({
        seq: e.seq,
        at: e.at,
        kind: e.kind,
        text: e.text,
        userRequirements: e.handoffUserSeq
          ? task.events.find((user) => user.seq === e.handoffUserSeq && user.role === "user")?.text
          : undefined,
      })),
    null,
    2,
  );
  const end = Math.min(text.length, offset + 20000);
  return JSON.stringify({
    offset,
    nextOffset: end < text.length ? end : null,
    totalCharacters: text.length,
    text: text.slice(offset, end),
  });
}

export function sidekickForbiddenTool(tool: string): boolean {
  const name = (tool.split("__").at(-1) ?? tool).replace(/[-_]/g, "").toLowerCase();
  return [
    "agent",
    "task",
    "subagent",
    "subagentfork",
    "sidekick",
    "readsidekick",
    "workflow",
    "agentsend",
    "sendmessage",
    "interruptagent",
    "listagents",
    "teamcreate",
    "teamdelete",
    "askuserquestion",
    "askuser",
    "clarifyuser",
    "present",
    "creategoal",
    "updategoal",
    "enterplanmode",
    "exitplanmode",
    "pushnotification",
    "schedulewakeup",
    "croncreate",
    "crondelete",
    "reportfindings",
  ].includes(name);
}

export const handoffToolDescription =
  "向唯一持久副手派明确任务，默认block:true等待报告。有独立主手工作时才用false，之后read_sidekick等待，禁止轮询。精确接口、代码、最窄验证、冻结输入及运行时状态写进brief；高风险查询/指标/评测规则/阈值由主手定稿，副手机械执行。副手不负责用户消息、PR或提交。运行中再次调用用于同一副手的更新，不创建第二个副手；未确认送达必须如实处理。";
// 原生中断消息只证明停止请求，不能推导工具从未开始或已有副作用已撤销。
export const interruptionEvidenceNote =
  "中断证据边界：原生interrupt/取消回执不代表工具从未启动、未执行或已回滚。此前工具可能已产生文件或其他影响；即使回执写interrupted，也不能据此声称从未执行。没有原始证据时只报告已中断，先前执行情况/输出/退出码/耗时未确认；不猜测，也不为补证擅自增加工具或命令。";
export const reviewReportNote =
  "主手先核对完整diff、原始要求与证据，给出结论；报告文字是声明，不是证据。不要重跑已充分验证的工作；仅修改呈现时使用已冻结结果。批量整理全部反馈再交接，先完成承诺用户的回话或权威动作。对细节不确定时查明，不猜测。" +
  interruptionEvidenceNote;
