import type { TwoCodeTask } from "../contract.js";

const normalized = (text: string) => text.replace(/\\+/g, "/").toLowerCase();
/** 会话配置路径误入brief会引发副手错误读写和全盘搜索；派工前说明真实工作区，不静默改路径。 */
export function assertHandoffWorkspace(
  task: TwoCodeTask,
  message: string,
  sessionDirectory: string,
) {
  const brief = normalized(message);
  const original = normalized(
    task.events.findLast((e) => e.role === "user" && e.kind === "message")?.text ?? "",
  );
  const own = normalized(sessionDirectory).replace(/\/$/, ""),
    workspace = normalized(task.workspacePath);
  if (original.includes(own) || workspace === own) return;
  const boundary = (suffix: string) => /^(?:$|[/\s"'`])/.test(suffix);
  const nested = workspace.startsWith(`${own}/`) ? workspace.slice(own.length) : undefined;
  // 实测中错误路径落到session根目录，绕过了原先仅检查connection的守卫；视觉缓存仍可引用。
  const wrong = brief
    .split(own)
    .slice(1)
    .some(
      (suffix) =>
        boundary(suffix) &&
        !/^\/(?:lead|sidekick)\/visual\//.test(suffix) &&
        !(nested && suffix.startsWith(nested) && boundary(suffix.slice(nested.length))),
    );
  if (wrong)
    throw new Error(
      `派工尚未执行：brief引用了底座会话目录，它不是工作区。真实共享工作区=${JSON.stringify(task.workspacePath)}。请用当前目录相对路径修正本次派工，不必搜索配置目录或更换文件。`,
    );
}
