import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PrivateConnection } from "./connection-types.js";

/** 只读导入两条官方渠道；相同模型ID不代表同一个计费连接。 */
export async function stepConnections(home = homedir()): Promise<PrivateConnection[]> {
  let data;
  try {
    data = JSON.parse(await readFile(join(home, ".stepcode", "models.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("本机Step Code模型配置无法读取");
  }
  return ["step-api", "step-plan"].flatMap((provider) => {
    const config = data.providers?.[provider];
    const model = config?.models?.find((item: { id?: string }) => item.id === "step-5-preview");
    if (!model) return [];
    const name = provider === "step-api" ? "Step-5 API" : "Step-5 订阅";
    return [
      {
        id: `native:step-code:${provider}`,
        harness: "step-code" as const,
        provider,
        name,
        baseUrl: String(config.baseUrl ?? ""),
        api: config.api ?? "openai-completions",
        apiKey: String(config.apiKey ?? ""),
        providerConfig: config,
        models: [{ ...model, name }],
      },
    ];
  });
}

/** 官方订阅同时提供两种协议；只映射已知端点，避免把自定义网关凭据转送官方。 */
export function stepPlanHarnessConnections(connections: PrivateConnection[]): PrivateConnection[] {
  const plan = connections.find((c) => c.harness === "step-code" && c.provider === "step-plan");
  if (
    !plan ||
    plan.api !== "openai-completions" ||
    plan.baseUrl.replace(/\/$/, "") !== "https://api.stepfun.com/step_plan/v1"
  )
    return [];
  const models = plan.models.map((model) => ({
    ...Object.fromEntries(Object.entries(model).filter(([key]) => key !== "compat")),
    id: model.id,
    name: model.name,
  }));
  return (["pi", "claude-code"] as const).map((harness) => ({
    id: `native:${harness}:step-plan`,
    harness,
    provider: "step-plan",
    name: plan.name,
    baseUrl: harness === "pi" ? plan.baseUrl : "https://api.stepfun.com/step_plan",
    api: harness === "pi" ? "openai-completions" : "anthropic-messages",
    apiKey: plan.apiKey,
    ...(harness === "claude-code" ? { authMode: "token" as const } : {}),
    models,
  }));
}
