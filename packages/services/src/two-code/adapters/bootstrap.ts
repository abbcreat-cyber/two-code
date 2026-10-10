import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IZCodeAgentService, IZCodeSessionService } from "../../index.js";
import type { HarnessInfo, ITwoCodeService, TwoCodeTask } from "../contract.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { TwoCodeCoordinator } from "../app/coordinator.js";
import { JsonTaskStore } from "./json-store.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
import { ZCodeAdapter } from "./zcode.js";
import { claudeExecutable, claudeConfiguredModels, piConfiguredModels, piEntry } from "./paths.js";
import { TaskLease } from "./task-lease.js";
import { JsonPreferences } from "./preferences.js";

export function createTwoCodeService(
  agent: IZCodeAgentService,
  sessions: IZCodeSessionService,
  projectTask?: (task: TwoCodeTask) => Promise<void>,
): ITwoCodeService {
  const root =
    process.env.TWO_CODE_HOME ??
    (process.platform === "win32" ? "D:/Apps/TwoCode/data" : join(homedir(), ".two-code"));
  const service = new TwoCodeCoordinator({
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
      const [claude, pi, models, claudeModels] = await Promise.all([
        claudeExecutable(),
        piEntry(),
        piConfiguredModels(),
        claudeConfiguredModels(),
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
          defaultModel: claudeModels[0]?.id,
          models: claudeModels,
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
  if (projectTask) {
    const logger = createServiceLogger("two-code-task-index");
    const signatures = new Map<string, string>();
    let tail = Promise.resolve();
    service.onDidChange((task) => {
      // 流式正文由聊天订阅消费；索引仅在组织/执行状态变化时更新，避免每token重拉侧栏。
      const signature = JSON.stringify([
        task.title,
        task.status,
        task.permissions.length,
        task.lead.status,
        task.sidekick.status,
        task.requestIds.length,
      ]);
      if (signatures.get(task.id) === signature) return;
      signatures.set(task.id, signature);
      tail = tail
        .then(() => projectTask(task))
        .catch((error) => {
          signatures.delete(task.id);
          logger.error(undefined, "原生任务索引投影失败，执行事实仍保留", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
    const dispose = service.dispose.bind(service);
    service.dispose = async () => {
      await dispose();
      await tail;
    };
  }
  return service;
}
