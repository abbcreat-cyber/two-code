import { access } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

/** 非默认盘安装的Git已在PATH，但原生CLI只按默认目录找Bash，甚至选中WSL。仅修正本子进程。 */
export async function nativeWindowsShellEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  if (platform !== "win32") return {};
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const searchPath = environment[pathKey] ?? "";
  const candidates: string[] = [];
  for (const raw of searchPath.split(delimiter).filter(Boolean)) {
    const root = raw.replace(/^"|"$/g, "");
    try {
      await access(join(root, "git.exe"));
      candidates.push(join(root, "bash.exe"), join(root, "..", "bin", "bash.exe"));
    } catch {
      /* 只从已存在的Git安装推导，System32/bash不是原生Git Bash。 */
    }
  }
  for (const name of ["ProgramFiles", "ProgramFiles(x86)"])
    if (environment[name]) candidates.push(join(environment[name]!, "Git", "bin", "bash.exe"));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return {
        [pathKey]: dirname(candidate) + delimiter + searchPath,
        TWO_CODE_NATIVE_BASH: candidate,
      };
    } catch {
      /* 找不到则保持原环境，不报告虚构的可用工具。 */
    }
  }
  return {};
}
