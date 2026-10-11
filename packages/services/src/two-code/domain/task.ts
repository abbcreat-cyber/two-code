import type {
  CreateTwoCodeTask,
  EngineSelection,
  TaskEvent,
  TwoCodeTask,
  TwoCodePreferences,
} from "../contract.js";

export function reconfigureTask(task: TwoCodeTask, preferences: TwoCodePreferences): TwoCodeTask {
  validateSelection(preferences.lead);
  validateSelection(preferences.sidekick);
  if (task.status === "running") throw new Error("任务仍在执行，请先停止");
  const next = structuredClone(task);
  for (const role of ["lead", "sidekick"] as const) {
    // 原生会话ID只属于原脚手架；换模型保留上下文，不能跨脚手架误用。
    if (next[role].sessionId && next[role].selection.harness !== preferences[role].harness)
      throw new Error("已有上下文的脚手架请在新任务中更换；本任务可直接更换模型");
    next[role].selection = { ...preferences[role] };
    next[role].actualModel = undefined;
  }
  next.mode = preferences.mode;
  next.dual = preferences.dual;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function validateSelection(selection: EngineSelection): void {
  if (!selection || !["zcode", "claude-code", "pi", "step-code"].includes(selection.harness)) {
    throw new Error("请选择有效脚手架");
  }
  if (selection.harness === "zcode" && Boolean(selection.model) !== Boolean(selection.provider)) {
    throw new Error("ZCode自选模型须同时填写提供方和模型ID，或同时留空沿用原生设置");
  }
  for (const value of [
    selection.provider,
    selection.model,
    selection.modelLabel,
    selection.thinking,
  ]) {
    if (value !== undefined && (typeof value !== "string" || value.length > 300)) {
      throw new Error("模型配置无效");
    }
  }
}
export function newTask(id: string, input: CreateTwoCodeTask, updatedAt: string): TwoCodeTask {
  validateSelection(input.lead);
  validateSelection(input.sidekick);
  if (typeof input.dual !== "boolean") throw new Error("请选择单角色或双角色");
  return {
    mode: input.mode ?? "build",
    usage: [],
    id,
    workspacePath: input.workspacePath,
    title: input.title?.trim().slice(0, 120) || "新任务",
    dual: input.dual,
    status: "idle",
    lead: { selection: { ...input.lead }, status: "idle" },
    sidekick: { selection: { ...input.sidekick }, status: "idle" },
    events: [],
    permissions: [],
    requestIds: [],
    updatedAt,
  };
}
export function appendEvent(
  task: TwoCodeTask,
  event: Omit<TaskEvent, "seq" | "at">,
  at: string,
): void {
  task.updatedAt = at;
  task.events.push({ ...event, seq: (task.events.at(-1)?.seq ?? 0) + 1, at: task.updatedAt });
}
export function sidekickPrompt(task: TwoCodeTask, assignment: string): string {
  // 原始约束不能只依靠主手转述；只附当前轮原文，避免把整个历史重复注入。
  const original = task.events.findLast(
    (event) => event.role === "user" && event.kind === "message",
  )?.text;
  if (!original) return assignment;
  return `本次派工：\n${assignment}\n\n本轮用户原始请求（用于核对范围和限制）：\n${original}\n\n你只执行本次派工，遵守原始请求的限制；原文中主手派工、汇总和向用户回复的动作仍由主手完成。`;
}
export const leadInstruction = `你是主手。所有面向用户的输出一律中文。你负责澄清、计划、判断、审查和最终回复。
本任务提供一个持久副手，调用sidekick派出明确任务；后续交接复用同一副手。副手使用独立脚手架和模型，共享工作目录。
实现和验证优先委派。自己先确定接口、范围及可验证的成功条件。不要把未返回的派工说成完成。
block默认为true；仅有独立工作时用false，之后必须read_sidekick读取报告。不要重复运行已经有充分证据的测试。
副手回报是待审查的材料：核对原始要求、文件、工具结果及失败证据，再对用户负责。completed只表示执行结束。
不要用其他内置代理工具绕过持久副手。遇到权限或不可用模型，如实报告，不替换脚手架或模型。`;
export const sidekickInstruction = `你是持久副手。所有面向用户的输出一律中文。按主手给出的范围和验收条件执行并报告证据。
同一任务的后续交接沿用你的上下文，不重做已经完成的工作。共享目录中可能有别人的改动，不要覆盖无关改动。
不要创建代理、派工、联系用户、提交或推送Git。遇到缺少信息或权限，报告实际阻碍，不伪造完成。
先完成要求的动作再汇报。捕获命令输出到变量时须在同次调用中展示，未捕获不等于没有输出；如实标注合并输出。
除明确授权外，不操作鼠标或用户浏览器，不运行破坏性清理。用文件和真实工具结果支撑报告。`;
