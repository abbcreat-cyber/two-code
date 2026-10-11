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
  const own = normalized(sessionDirectory);
  for (const role of ["lead", "sidekick"]) {
    const config = `${own}/${role}/connection`;
    if (brief.includes(config) && !original.includes(config))
      throw new Error(
        `派工尚未执行：brief引用了底座会话配置目录，它不是工作区。真实共享工作区=${JSON.stringify(task.workspacePath)}。请用当前目录相对路径修正本次派工，不必搜索配置目录或更换文件。`,
      );
  }
}
