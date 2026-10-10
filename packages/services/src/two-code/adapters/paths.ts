import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

export async function existingPath(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* 继续检查下一个安装位置。 */
    }
  }
}
export async function claudeExecutable(): Promise<string | undefined> {
  const roots = (process.env.PATH ?? "").split(delimiter);
  return existingPath([
    process.env.TWO_CODE_CLAUDE_CLI ?? "",
    join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"),
    ...roots.flatMap((root) => [
      join(root, process.platform === "win32" ? "claude.exe" : "claude"),
      join(root, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    ]),
  ]);
}
export async function piEntry(): Promise<string | undefined> {
  const roots = (process.env.PATH ?? "").split(delimiter);
  return existingPath([
    process.env.TWO_CODE_PI_CLI ?? "",
    ...roots.flatMap((root) => [
      join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
      join(
        root,
        "..",
        "lib",
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "bundle",
        "cli.js",
      ),
    ]),
  ]);
}
export async function piConfiguredModels() {
  try {
    const config = JSON.parse(
      await readFile(join(homedir(), ".pi", "agent", "models.json"), "utf8"),
    );
    return Object.entries(config.providers ?? {}).flatMap(([provider, value]) => {
      const models = (value as { models?: Array<{ id: string; name?: string }> }).models ?? [];
      return models
        .filter((model) => typeof model.id === "string")
        .map((model) => ({ id: model.id, provider, name: model.name || model.id }));
    });
  } catch {
    return [];
  }
}
