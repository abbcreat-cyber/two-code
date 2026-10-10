import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { PrivateConnection } from "./native-connections.js";
import { piEntry } from "./paths.js";

export const subscriptionSchema = z.object({
  agentDir: z.string().min(1),
  node: z.string().min(1),
  proxy: z.string().url(),
});
const configuration = subscriptionSchema.extend({
  models: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1),
});
export async function readChatGPTConnection(root: string): Promise<PrivateConnection | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(root, "chatgpt-connection.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const config = configuration.parse(JSON.parse(raw));
  return {
    id: "two-code:chatgpt",
    harness: "pi",
    provider: "two-code-chatgpt",
    name: "ChatGPT 套餐",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    apiKey: "",
    subscription: { agentDir: config.agentDir, node: config.node, proxy: config.proxy },
    models: config.models.map((m) => ({ ...m, reasoning: true })),
  };
}
export function subscriptionEnvironment(
  config: z.infer<typeof subscriptionSchema>,
): NodeJS.ProcessEnv {
  return {
    PI_CODING_AGENT_DIR: config.agentDir,
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: config.proxy,
    HTTPS_PROXY: config.proxy,
    ALL_PROXY: config.proxy,
    http_proxy: config.proxy,
    https_proxy: config.proxy,
    all_proxy: config.proxy,
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
    ELECTRON_RUN_AS_NODE: undefined,
  };
}
export async function probeSubscription(c: PrivateConnection, modelId: string) {
  const config = c.subscription!,
    entry = await piEntry();
  if (!entry) return { ok: false, message: "未找到 Pi 脚手架" };
  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn(
      config.node,
      [
        "--use-env-proxy",
        entry,
        "--provider",
        "openai",
        "--model",
        modelId,
        "--thinking",
        "low",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "--no-approve",
        "--print",
        "Reply OK.",
      ],
      {
        cwd: config.agentDir,
        windowsHide: true,
        env: { ...process.env, ...subscriptionEnvironment(config), PI_OFFLINE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let text = "",
      error = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30000);
    child.stdout.on("data", (part: Buffer) => {
      text = (text + part).slice(-1000);
    });
    child.stderr.on("data", (part: Buffer) => {
      error = (error + part).slice(-3000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, message: "无法启动 Pi 套餐连接" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0 && !!text.trim();
      resolve({
        ok,
        message: ok
          ? "已收到套餐模型响应"
          : timedOut
            ? "连接超时（30秒）"
            : /Subscription Sharing usage limit/i.test(error)
              ? "订阅共享额度或权限受限"
              : "套餐请求失败，请检查授权、模型权限和代理",
      });
    });
  });
}
