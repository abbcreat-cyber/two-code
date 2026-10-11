import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { TwoCodeMode, ActorRole } from "../contract.js";
import { sidekickForbiddenTool } from "../domain/handoffs.js";

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(await canonical(parent), relative(parent, path));
  }
}
/** 未知工具和 shell 不猜测副作用；计划模式直接拦截，编辑模式仅放行工作区内文件。 */
export async function permissionDecision(
  mode: TwoCodeMode,
  tool: string,
  detail: string,
  cwd: string,
  role?: ActorRole,
): Promise<"allow" | "deny" | "ask"> {
  if (role === "sidekick" && sidekickForbiddenTool(tool)) return "deny";
  if (mode === "yolo") return "allow";
  const name = tool.toLowerCase();
  if (
    [
      "read",
      "check_text_encoding",
      "mcp__two_code__check_text_encoding",
      "view_image",
      "mcp__two_code__view_image",
      "read_file",
      "list_directory",
      "find_files",
      "search_files",
      "search_web",
      "grep",
      "glob",
      "find",
      "ls",
      "websearch",
      "webfetch",
      "todowrite",
      "sidekick",
      "read_sidekick",
      "read_handoff_history",
      "mcp__two_code__read_handoff_history",
      "mcp__two_code__sidekick",
      "mcp__two_code__read_sidekick",
    ].includes(name)
  )
    return "allow";
  if (mode === "plan") return "deny";
  if (
    mode === "edit" &&
    ["write", "edit", "write_file", "edit_file", "multiedit", "notebookedit"].includes(name)
  ) {
    try {
      const args = JSON.parse(detail);
      const file = args.file_path ?? args.path ?? args.notebook_path;
      if (typeof file !== "string" || !file) return "ask";
      const rel = relative(await canonical(cwd), await canonical(resolve(cwd, file)));
      if (
        rel &&
        rel !== ".." &&
        !rel.startsWith("..\\") &&
        !rel.startsWith("../") &&
        !isAbsolute(rel)
      )
        return "allow";
    } catch {
      /* 无法识别目标时交由用户确认。 */
    }
  }
  return "ask";
}
