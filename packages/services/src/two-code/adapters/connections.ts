import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Emitter } from "@zcode/rpc";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import type {
  EngineSelection,
  HarnessInfo,
  ModelSettingsView,
  SaveHarnessConnection,
  TwoCodeTask,
} from "../contract.js";
import type { EngineConnection } from "../app/ports.js";
import { nativeConnections, type PrivateConnection } from "./native-connections.js";
import { nameForModel, readLocalModelRoutes } from "./model-names.js";
import { probeConnection } from "./connection-probe.js";
import { findModelThinkingProfile, piThinkingMetadata } from "../domain/thinking.js";
import {
  readChatGPTConnection,
  probeSubscription,
  subscriptionSchema,
} from "./chatgpt-subscription.js";
const model = z
  .object({
    id: z.string().trim().min(1).max(300),
    name: z.string().trim().min(1).max(300),
    aliases: z.array(z.string()).optional(),
    reasoning: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .passthrough();
const connection = z.object({
  subscription: subscriptionSchema.optional(),
  id: z.string().min(1).max(300),
  harness: z.enum(["claude-code", "pi", "step-code"]),
  provider: z.string().max(300),
  name: z.string().trim().min(1).max(300),
  baseUrl: z.string().max(2000),
  api: z.enum(["anthropic-messages", "openai-completions", "openai-responses"]),
  apiKey: z.string().max(16000),
  authMode: z.enum(["token", "api-key"]).optional(),
  providerConfig: z.record(z.string(), z.unknown()).optional(),
  models: z.array(model).min(1).max(200),
});
const stateSchema = z.object({
  revision: z.string(),
  connections: z.array(connection),
  deleted: z.array(z.string()),
});
type State = z.infer<typeof stateSchema>;
export class TwoCodeConnections {
  private readonly changes = new Emitter<void>();
  readonly onDidChange = this.changes.event;
  dispose() {
    this.changes.dispose();
  }
  private readonly file: string;
  constructor(
    private readonly root: string,
    private readonly imports = nativeConnections,
  ) {
    this.file = join(root, "model-connections.json");
  }
  private async state(): Promise<State> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: "native", connections: [], deleted: [] };
      throw new Error("Two Code模型配置损坏，已保留原文件");
    }
  }
  private async all(state: State) {
    const entries = new Map((await this.imports()).map((c) => [c.id, c]));
    for (const c of state.connections) entries.set(c.id, c);
    const subscription = await readChatGPTConnection(this.root);
    if (subscription) {
      const saved = entries.get(subscription.id);
      entries.set(subscription.id, {
        ...saved,
        ...subscription,
        name: saved?.name ?? subscription.name,
        models: saved?.models ?? subscription.models,
      });
    }
    return [...entries.values()].filter((c) => !state.deleted.includes(c.id));
  }
  private async visible(state: State): Promise<ModelSettingsView> {
    const connections = await this.all(state);
    return {
      revision: state.revision,
      connections: await Promise.all(
        connections.map(async (c) => {
          const routes = await readLocalModelRoutes(c.baseUrl);
          return {
            id: c.id,
            harness: c.harness,
            provider: c.provider,
            name: c.name,
            baseUrl: c.baseUrl,
            api: c.api,
            hasApiKey: !!c.apiKey,
            authentication: c.subscription ? ("chatgpt" as const) : undefined,
            source:
              c.subscription || state.connections.some((saved) => saved.id === c.id)
                ? ("two-code" as const)
                : ("native" as const),
            models: c.models.map((m) => ({
              id: m.id,
              aliases: m.aliases,
              reasoning: m.reasoning,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
              ...nameForModel(m.id, routes, false, m.name),
            })),
          };
        }),
      ),
    };
  }
  async read() {
    return this.visible(await this.state());
  }
  async test(input: { id: string; revision: string; modelId: string }) {
    const state = await this.state();
    if (input.revision !== state.revision) throw new Error("设置已更新，请刷新后重试");
    const c = (await this.all(state)).find((entry) => entry.id === input.id);
    if (!c || !c.models.some((m) => m.id === input.modelId)) throw new Error("连接或模型已移除");
    return c.subscription ? probeSubscription(c, input.modelId) : probeConnection(c, input.modelId);
  }
  async save(input: SaveHarnessConnection): Promise<ModelSettingsView> {
    await withFileLock(this.file, async () => {
      const state = await this.state();
      if (input.revision !== state.revision)
        throw new Error("设置已在其他窗口更新，请刷新后再保存");
      const existing = (await this.all(state)).find((c) => c.id === input.connection.id);
      const c = connection.parse({
        ...existing,
        ...input.connection,
        apiKey: input.apiKey || existing?.apiKey || "",
        subscription: existing?.subscription,
      });
      // 套餐授权只允许固定的官方端点；UI改名不能把令牌改成API密钥或转送第三方。
      if (
        c.subscription &&
        (c.baseUrl !== existing!.baseUrl || c.api !== existing!.api || input.apiKey)
      )
        throw new Error("ChatGPT套餐连接不使用API密钥，地址与接口由Pi管理");
      c.models = c.models.map((m) => ({
        ...existing?.models.find((old) => old.id === m.id),
        ...m,
      }));
      if (existing && (c.harness !== existing.harness || c.provider !== existing.provider))
        throw new Error("已有连接不能更改脚手架或提供方标识，请新增连接");
      if (c.baseUrl) {
        const url = new URL(c.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new Error("请输入HTTP或HTTPS地址，密钥请填入独立字段");
      } else if (!existing || c.harness === "pi") throw new Error("请填写API地址");
      if (c.harness === "claude-code" && c.api !== "anthropic-messages")
        throw new Error("Claude Code需要Anthropic Messages接口");
      if (new Set(c.models.map((m) => m.id)).size !== c.models.length)
        throw new Error("同一连接的模型ID不能重复");
      if (
        (await this.all(state)).some(
          (other) =>
            other.id !== c.id && other.harness === c.harness && other.provider === c.provider,
        )
      )
        throw new Error("提供方标识已存在");
      state.connections = [...state.connections.filter((old) => old.id !== c.id), c];
      state.deleted = state.deleted.filter((id) => id !== c.id);
      state.revision = randomUUID();
      await atomicWritePrivateTextFile(this.file, JSON.stringify(state));
    });
    this.changes.fire();
    return this.read();
  }
  async remove(input: { id: string; revision: string }) {
    await withFileLock(this.file, async () => {
      const state = await this.state();
      if (state.revision !== input.revision)
        throw new Error("设置已在其他窗口更新，请刷新后再保存");
      if (!(await this.all(state)).some((c) => c.id === input.id)) throw new Error("连接不存在");
      state.connections = state.connections.filter((c) => c.id !== input.id);
      state.deleted = [...new Set([...state.deleted, input.id])];
      state.revision = randomUUID();
      await atomicWritePrivateTextFile(this.file, JSON.stringify(state));
    });
    this.changes.fire();
    return this.read();
  }
  async catalog(base: HarnessInfo[]): Promise<HarnessInfo[]> {
    const view = await this.read();
    return base.map((h) =>
      h.id === "zcode"
        ? h
        : {
            ...h,
            defaultModel: view.connections.find((c) => c.harness === h.id && !c.provider)?.models[0]
              ?.id,
            models: view.connections
              .filter((c) => c.harness === h.id)
              .flatMap((c) =>
                c.models.map((m) => ({
                  id: m.id,
                  name: m.name,
                  aliases: m.aliases,
                  realModel: m.realModel,
                  provider: c.provider || undefined,
                })),
              ),
          },
    );
  }
  private resolve(
    selection: EngineSelection,
    state: State,
    all: PrivateConnection[],
  ): EngineConnection | undefined {
    if (selection.harness === "zcode") return;
    if (selection.harness === "pi" && !selection.provider) return;
    const c = all.find(
      (entry) =>
        entry.harness === selection.harness && entry.provider === (selection.provider || ""),
    );
    if (!c) throw new Error("所选连接已移除，请在模型设置中重新选择");
    if (
      !c.subscription &&
      c.harness !== "step-code" &&
      !(c.harness === "claude-code" && c.baseUrl) &&
      !state.connections.some((saved) => saved.id === c.id) &&
      !(c.harness === "pi" && c.models.some((m) => findModelThinkingProfile(m.id, m.name)))
    )
      return;
    if (
      selection.model &&
      !c.models.some((m) => m.id === selection.model || m.aliases?.includes(selection.model!))
    )
      throw new Error("所选模型已移除，请重新选择模型");
    return {
      subscription: c.subscription,
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      api: c.api,
      authMode: c.authMode,
      modelAliases: Object.fromEntries(
        c.models.flatMap((m) =>
          (m.aliases ?? [])
            .filter((a) => ["sonnet", "opus", "haiku"].includes(a))
            .map((a) => [a, m.id]),
        ),
      ),
      providerConfig: {
        ...c.providerConfig,
        baseUrl: c.baseUrl,
        api: c.api,
        apiKey: c.apiKey,
        models: c.models.map((m) => ({
          ...Object.fromEntries(
            Object.entries(m).filter(([key]) => !["aliases", "realModel"].includes(key)),
          ),
          reasoning: m.reasoning ?? true,
          contextWindow: m.contextWindow ?? 128000,
          maxTokens: m.maxTokens ?? 8192,
          ...piThinkingMetadata(m.id, m.name, c.api),
          compat: {
            ...(m as { compat?: Record<string, unknown> }).compat,
            ...piThinkingMetadata(m.id, m.name, c.api).compat,
          },
        })),
      },
    };
  }
  async freeze(task: TwoCodeTask) {
    const state = await this.state(),
      all = await this.all(state);
    return {
      lead: this.resolve(task.lead.selection, state, all),
      ...(task.dual ? { sidekick: this.resolve(task.sidekick.selection, state, all) } : {}),
    };
  }
}
