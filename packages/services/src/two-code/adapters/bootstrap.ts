import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IZCodeAgentService, IZCodeSessionService } from "../../index.js";
import type { HarnessInfo, ITwoCodeService } from "../contract.js";
import { TwoCodeCoordinator } from "../app/coordinator.js";
import { JsonTaskStore } from "./json-store.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
import { ZCodeAdapter } from "./zcode.js";
import { claudeExecutable, piConfiguredModels, piEntry } from "./paths.js";
import { TaskLease } from "./task-lease.js";
import { JsonPreferences } from "./preferences.js";

export function createTwoCodeService(
  agent: IZCodeAgentService,
  sessions: IZCodeSessionService,
): ITwoCodeService {
  const root =
    process.env.TWO_CODE_HOME ??
    (process.platform === "win32" ? "D:/Apps/TwoCode/data" : join(homedir(), ".two-code"));
  return new TwoCodeCoordinator({
    lease: new TaskLease(root),
    store: new JsonTaskStore(join(root, "tasks")),
    sessionRoot: join(root, "sessions"),
    preferences: new JsonPreferences(root),
    validateWorkspace: async (path) => {
      if (!path || typeof path !== "string") throw new Error("请先选择工作目录");
      const resolved = await realpath(path);
      if (!(await stat(resolved)).isDirectory()) throw new Error("工作目录无效");
      return resolved;
    },
    catalog: async (): Promise<HarnessInfo[]> => {
      const [claude, pi, models] = await Promise.all([
        claudeExecutable(),
        piEntry(),
        piConfiguredModels(),
      ]);
      return [
        {
          id: "zcode",
          name: "ZCode",
          available: true,
          detail: "保留原生执行链；模型在原生设置中配置",
          models: [],
        },
        {
          id: "claude-code",
          name: "Claude Code",
          available: !!claude,
          detail: claude ? "已检测到本机 CLI，沿用其认证配置" : "未找到 Claude Code CLI",
          models: [],
        },
        {
          id: "pi",
          name: "Pi",
          available: !!pi,
          detail: pi ? "原生 RPC；沿用模型配置，工具按 Pi 默认语义执行" : "未找到 Pi CLI",
          models,
        },
      ];
    },
    createAdapter: (harness) =>
      harness === "claude-code"
        ? new ClaudeAdapter()
        : harness === "pi"
          ? new PiAdapter()
          : new ZCodeAdapter(agent, sessions),
  });
}
