import type { TwoCodeTask } from "../contract.js";

export function handoffEnvelope(message: string, update = false): string {
  const body = message.replace(
    /^\s*<lead_(?:handoff|update)>\s*([\s\S]*?)\s*<\/lead_(?:handoff|update)>\s*$/,
    "$1",
  );
  return update
    ? `The lead sent an update for the handoff you are working on. Fold it in and continue (or wind down, if that is what it asks):\n\n<lead_update>\n${body}\n</lead_update>\n\n${interruptionEvidenceNote}`
    : `<lead_handoff>\n${body}\n</lead_handoff>\n\n先完成动作和必要验证，再报告产物路径、关键结果及一份验证证据。普通小任务通常3–6行；不要重复任务、整段代码或已确认规则。复杂任务和失败可展开必要证据。未变化的已通过检查不重跑。`;
}

/** 原始事件就是账本；分页不生成第二份摘要，跨原生压缩仍能逐字恢复。 */
export function handoffHistory(task: TwoCodeTask, offset = 0): string {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("交接历史位置无效");
  const text = JSON.stringify(
    task.events
      // 连续任务回读也必须保留原生证据；仅模型报告会让已验证结果退化为口述。
      .filter(
        (e) =>
          ["handoff", "handoff_update", "handoff_report"].includes(e.kind) ||
          (e.role === "sidekick" && e.kind === "verification"),
      )
      .map((e) => ({
        seq: e.seq,
        at: e.at,
        kind: e.kind,
        role: e.role,
        toolCallId: e.toolCallId,
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
export const readSidekickToolDescription =
  "等待并读取本轮副手的真实报告；本轮未派工时只返回状态说明及历史入口，不代表产生了新报告或新执行。";
// 原生中断消息只证明停止请求，不能推导工具从未开始或已有副作用已撤销。
export const interruptionEvidenceNote =
  "中断证据边界：原生interrupt/取消回执不代表工具从未启动、未执行或已回滚。此前工具可能已产生文件或其他影响；即使回执写interrupted，也不能据此声称从未执行。没有原始证据时只报告已中断，先前执行情况/输出/退出码/耗时未确认；不猜测，也不为补证擅自增加工具或命令。";
export const reviewReportNote =
  "按验收条件检查关键产物和已有证据；已充分验证且未变化的内容不重测。需要返工时一次列齐。通过后直接简短交付，不复述整份报告；只有新风险/矛盾才补查。";
