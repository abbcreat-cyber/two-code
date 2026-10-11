import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HarnessConnection } from "../contract.js";
import { stepConnections } from "./step-connections.js";
import type { PrivateConnection } from "./connection-types.js";
export type { PrivateConnection } from "./connection-types.js";
async function readJson(file: string) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("本机模型配置无法读取，请检查JSON格式");
  }
}
export async function nativeConnections(home = homedir()): Promise<PrivateConnection[]> {
  const [claude, pi] = await Promise.all([
    readJson(join(home, ".claude/settings.json")),
    readJson(join(home, ".pi/agent/models.json")),
  ]);
  const models = new Map<string, HarnessConnection["models"][number]>();
  for (const alias of ["sonnet", "opus", "haiku"]) {
    const id = claude.env?.[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`];
    if (typeof id !== "string" || !id) continue;
    const model = models.get(id) ?? { id, name: id, aliases: [] };
    model.aliases!.push(alias);
    models.set(id, model);
  }
  if (
    claude.model &&
    ![...models.values()].some((m) => m.id === claude.model || m.aliases?.includes(claude.model))
  )
    models.set(claude.model, { id: claude.model, name: claude.model });
  const connections: PrivateConnection[] = [
    {
      id: "native:claude-code",
      harness: "claude-code",
      provider: "",
      name: "本机 Claude Code",
      baseUrl: claude.env?.ANTHROPIC_BASE_URL || "",
      api: "anthropic-messages",
      apiKey: claude.env?.ANTHROPIC_AUTH_TOKEN || claude.env?.ANTHROPIC_API_KEY || "",
      authMode: claude.env?.ANTHROPIC_AUTH_TOKEN ? "token" : "api-key",
      models: models.size ? [...models.values()] : [{ id: "sonnet", name: "Sonnet" }],
    },
  ];
  for (const [provider, raw] of Object.entries(pi.providers ?? {})) {
    const config = raw as Record<string, unknown> & { models?: HarnessConnection["models"] };
    connections.push({
      id: `native:pi:${provider}`,
      harness: "pi",
      provider,
      name: provider,
      baseUrl: String(config.baseUrl ?? ""),
      api: String(config.api ?? "openai-completions") as HarnessConnection["api"],
      apiKey: String(config.apiKey ?? ""),
      providerConfig: config,
      models: (config.models ?? []).map((m) => ({ ...m, name: m.name || m.id })),
    });
  }
  return [...connections, ...(await stepConnections(home))];
}
