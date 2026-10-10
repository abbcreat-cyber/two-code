/** 只读显示元数据；不能改变实际发送的model/provider。 */
export function modelDisplayName(id: string): string {
  return id
    .replace(/^deepseek-/i, "DeepSeek ")
    .replace(/^mimo-/i, "MiMo ")
    .replace(/^glm-/i, "GLM-")
    .replace(/^gpt-/i, "GPT-")
    .replace(
      /-(flash|pro|astra|preview)$/i,
      (_, suffix: string) => ` ${suffix[0]!.toUpperCase()}${suffix.slice(1)}`,
    )
    .replace(/\bv(\d)/g, "V$1");
}
export interface ModelRoutes {
  routes: Record<string, { model: string }>;
}
export function parseModelRoutes(value: unknown): ModelRoutes | undefined {
  if (!value || typeof value !== "object" || !("routes" in value)) return;
  const entries = (value as { routes?: unknown }).routes;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return;
  const routes: ModelRoutes["routes"] = {};
  for (const [id, route] of Object.entries(entries)) {
    if (
      route &&
      typeof route === "object" &&
      typeof route.model === "string" &&
      route.model.length <= 300
    )
      routes[id] = { model: route.model };
  }
  return Object.keys(routes).length ? { routes } : undefined;
}
export async function readLocalModelRoutes(baseUrl: unknown): Promise<ModelRoutes | undefined> {
  if (typeof baseUrl !== "string") return;
  try {
    const url = new URL(baseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol)
    )
      return;
    const response = await fetch(new URL("/health", url.origin), {
      signal: AbortSignal.timeout(1200),
      redirect: "error",
    });
    if (!response.ok) return;
    const data = await response.text();
    if (data.length > 262144) return;
    return parseModelRoutes(JSON.parse(data));
  } catch {
    return;
  }
}
export function nameForModel(id: string, routes: ModelRoutes | undefined, localProxy: boolean) {
  const realModel = routes?.routes[id]?.model;
  return {
    name: realModel
      ? modelDisplayName(realModel)
      : localProxy
        ? "模型待确认"
        : modelDisplayName(id),
    ...(realModel ? { realModel } : {}),
  };
}
