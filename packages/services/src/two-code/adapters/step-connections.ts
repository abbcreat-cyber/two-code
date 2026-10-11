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
