import type { EngineRun } from "../app/ports.js";
import { sidekickForbiddenTool } from "../domain/handoffs.js";

/** 只陈述实际权限请求的上下文；拒绝一次请求不等于工具或整个环境不可用。 */
export function permissionDenied(
  input: Pick<EngineRun, "cwd" | "mode" | "role">,
  tool: string,
  detail: string,
): string {
  if (input.role === "sidekick" && sidekickForbiddenTool(tool))
    return `副手不能调用${tool}：这是主手的用户交互、目标或委派权限。请向主手报告需求，不要换工具绕过。`;
  let target: unknown;
  try {
    const args = JSON.parse(detail);
    target = args.file_path ?? args.path ?? args.notebook_path;
  } catch {
    /* 无文件参数的工具仍报告已知事实。 */
  }
  return `本次${tool}请求未获Two Code许可。当前工作区=${JSON.stringify(input.cwd)}；模式=${input.mode ?? "build"}${typeof target === "string" ? `；请求目标=${JSON.stringify(target)}` : ""}。先核对目标是否位于当前工作区及本次授权范围；正反斜杠转换不会改变父子目录关系。这不代表所有写入或整个工具被禁用，不要把未核实的原因说成结论，也不要通过其他工具绕过拒绝。`;
}
