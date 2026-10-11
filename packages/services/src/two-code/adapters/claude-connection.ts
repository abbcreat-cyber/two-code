import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EngineConnection } from "../app/ports.js";

/** 本机Messages→Chat网关会只提取tool_result文本；将原图片块放到同一用户消息顶层，工具配对保持不变。 */
export function liftToolImages(body: Record<string, unknown>): void {
  if (!Array.isArray(body.messages)) return;
  for (const message of body.messages) {
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    const images: unknown[] = [];
    message.content = message.content.map((block: Record<string, unknown>) => {
      if (block?.type !== "tool_result" || !Array.isArray(block.content)) return block;
      const content = block.content.filter((part) => {
        if (part?.type !== "image") return true;
        images.push(part);
        return false;
      });
      return content.length === block.content.length
        ? block
        : {
            ...block,
            content: content.length
              ? content
              : [{ type: "text", text: "该工具的图像结果附于本消息。" }],
          };
    });
    message.content.push(...images);
  }
}
export async function claudeConnection(connection?: EngineConnection, diagnosticPath?: string) {
  let close = async () => {};
  if (!connection?.baseUrl) return { env: undefined, close };
  let baseUrl = connection.baseUrl;
  const upstream = new URL(baseUrl);
  if (["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname)) {
    const stats = { requests: 0, nestedImages: 0, topLevelImages: 0, imageBytes: 0 };
    const secret = randomBytes(24).toString("hex");
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith(`/${secret}/`)) {
        res.writeHead(404).end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 64 * 1024 * 1024) throw Error("视觉请求超过64MB");
          chunks.push(chunk);
        }
        let body = Buffer.concat(chunks);
        const suffix = req.url.slice(secret.length + 1);
        if (req.method === "POST" && /\/messages(?:\?|$|\/)/.test(suffix)) {
          const parsed = JSON.parse(body.toString("utf8"));
          stats.requests++;
          for (const message of parsed.messages ?? [])
            if (Array.isArray(message.content))
              for (const b of message.content)
                if (b.type === "tool_result" && Array.isArray(b.content))
                  stats.nestedImages += b.content.filter(
                    (p: { type?: string }) => p.type === "image",
                  ).length;
          liftToolImages(parsed);
          for (const message of parsed.messages ?? [])
            if (Array.isArray(message.content))
              for (const b of message.content)
                if (b.type === "image") {
                  stats.topLevelImages++;
                  stats.imageBytes += b.source?.data?.length ?? 0;
                }
          body = Buffer.from(JSON.stringify(parsed));
        }
        const url = new URL(upstream.toString());
        url.pathname = upstream.pathname.replace(/\/$/, "") + suffix.split("?")[0];
        url.search = suffix.includes("?") ? suffix.slice(suffix.indexOf("?")) : "";
        const headers = { ...req.headers, host: url.host, "content-length": String(body.length) };
        delete headers["transfer-encoding"];
        const forwarded = (url.protocol === "https:" ? httpsRequest : httpRequest)(
          url,
          { method: req.method, headers },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          },
        );
        res.once("close", () => forwarded.destroy());
        forwarded.once("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end("图片通道转发失败");
        });
        forwarded.end(body);
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end("图片请求无法转换");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("图片通道端口不可用");
    baseUrl = `http://127.0.0.1:${address.port}/${secret}`;
    close = async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (diagnosticPath) {
        await mkdir(dirname(diagnosticPath), { recursive: true });
        await writeFile(diagnosticPath, JSON.stringify(stats));
      }
    };
  }
  return {
    close,
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: connection.authMode === "token" ? "" : connection.apiKey,
      ANTHROPIC_AUTH_TOKEN: connection.authMode === "token" ? connection.apiKey : "",
      ...Object.fromEntries(
        Object.entries(connection.modelAliases ?? {}).map(([alias, model]) => [
          `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`,
          model,
        ]),
      ),
    },
  };
}
