import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { nameForModel, readLocalModelRoutes } from "./model-names.js";
import type { HarnessInfo } from "../contract.js";

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
export async function stepExecutable(): Promise<string | undefined> {
  const name = process.platform === "win32" ? "step.exe" : "step";
  return existingPath([
    process.env.TWO_CODE_STEP_CLI ?? "",
    join(homedir(), ".stepcode", "bin", name),
    ...(process.env.PATH ?? "").split(delimiter).map((root) => join(root, name)),
  ]);
}
export async function piConfiguredModels() {
  try {
    const config = JSON.parse(
      await readFile(join(homedir(), ".pi", "agent", "models.json"), "utf8"),
    );
    const metadata = new Map<string, ReturnType<typeof readLocalModelRoutes>>();
    return (
      await Promise.all(
        Object.entries(config.providers ?? {}).map(async ([provider, value]) => {
          const p = value as { baseUrl?: string; models?: Array<{ id: string; name?: string }> };
          const key = p.baseUrl || "";
          if (!metadata.has(key)) metadata.set(key, readLocalModelRoutes(key));
          const routes = await metadata.get(key);
          return (p.models ?? [])
            .filter((model) => typeof model.id === "string")
            .map((model) => ({
              id: model.id,
              provider,
              ...nameForModel(
                model.id,
                routes,
                /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(key),
              ),
            }));
        }),
      )
    ).flat();
  } catch {
    return [];
  }
}

export async function claudeConfiguredModels() {
  try {
    const config = JSON.parse(await readFile(join(homedir(), ".claude", "settings.json"), "utf8"));
    const routes = await readLocalModelRoutes(config.env?.ANTHROPIC_BASE_URL);
    const localProxy = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(
      config.env?.ANTHROPIC_BASE_URL || "",
    );
    const models = new Map<string, HarnessInfo["models"][number]>();
    for (const alias of ["sonnet", "opus", "haiku"]) {
      const id = config.env?.[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`];
      if (typeof id === "string" && id) {
        const entry = models.get(id) ?? {
          id,
          ...nameForModel(id, routes, localProxy),
          aliases: [],
        };
        entry.aliases!.push(alias);
        models.set(id, entry);
      }
    }
    if (typeof config.model === "string")
      if (
        !models.has(config.model) &&
        ![...models.values()].some((m) => m.aliases?.includes(config.model))
      )
        models.set(config.model, {
          id: config.model,
          ...nameForModel(config.model, routes, localProxy),
        });
    return [...models.values()];
  } catch {
    return [];
  }
}
