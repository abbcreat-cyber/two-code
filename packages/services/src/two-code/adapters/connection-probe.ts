import type { PrivateConnection } from "./native-connections.js";
import { z } from "zod";

/** 名称路由元数据不能证明认证和推理可用，必须检查一次实际模型响应。 */
export async function probeConnection(
  c: PrivateConnection,
  modelId: string,
  request: typeof fetch = fetch,
) {
  if (!c.baseUrl) return { ok: false, message: "请先配置 API 地址后测试" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = new URL(
      c.baseUrl.replace(/\/$/, "") +
        {
          "anthropic-messages": /\/v1\/?$/.test(c.baseUrl) ? "/messages" : "/v1/messages",
          "openai-completions": "/chat/completions",
          "openai-responses": "/responses",
        }[c.api],
    );
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return { ok: false, message: "API 地址格式不正确" };
    const key = process.env[c.apiKey] || c.apiKey;
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const [name, value] of Object.entries(c.providerConfig?.headers ?? {}))
      if (typeof value === "string") headers[name] = value;
    if (c.api === "anthropic-messages") {
      headers["anthropic-version"] = "2023-06-01";
      if (key)
        headers[c.authMode === "token" ? "authorization" : "x-api-key"] =
          c.authMode === "token" ? `Bearer ${key}` : key;
    } else if (key && c.providerConfig?.authHeader !== false)
      headers.authorization = `Bearer ${key}`;
    const body =
      c.api === "openai-responses"
        ? { model: modelId, input: "Reply OK.", max_output_tokens: 32, store: false }
        : {
            model: modelId,
            messages: [{ role: "user", content: "Reply OK." }],
            max_tokens: 32,
            stream: false,
          };
    const response = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, message: `连接失败（HTTP ${response.status}）` };
    }
    const data = z.record(z.string(), z.unknown()).parse(await response.json());
    const hasText = (value: unknown) => typeof value === "string" && !!value.trim();
    const valid =
      c.api === "anthropic-messages"
        ? data.type === "message" &&
          Array.isArray(data.content) &&
          data.content.some(
            (item: { text?: string; thinking?: string }) =>
              hasText(item.text) || hasText(item.thinking),
          )
        : c.api === "openai-responses"
          ? data.object === "response" && Array.isArray(data.output) && data.output.length > 0
          : Array.isArray(data.choices) &&
            data.choices.some(
              (item: {
                message?: { content?: string; reasoning_content?: string; reasoning?: string };
              }) =>
                hasText(item.message?.content) ||
                hasText(item.message?.reasoning_content) ||
                hasText(item.message?.reasoning),
            );
    return valid && !data.error
      ? { ok: true, message: "已收到模型响应" }
      : { ok: false, message: "未收到有效模型响应" };
  } catch {
    // 不回传服务器正文或异常 URL，避免凭据进入 UI 和日志。
    return {
      ok: false,
      message: controller.signal.aborted
        ? "连接超时（20秒）"
        : "连接失败，请检查地址、密钥和服务状态",
    };
  } finally {
    clearTimeout(timer);
  }
}
