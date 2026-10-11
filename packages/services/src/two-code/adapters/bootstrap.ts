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
import { StepCodeAdapter } from "./step.js";
import { ZCodeAdapter } from "./zcode.js";
import { claudeExecutable, piEntry, stepExecutable } from "./paths.js";
import { TaskLease } from "./task-lease.js";
import { JsonPreferences } from "./preferences.js";
import { TwoCodeConnections } from "./connections.js";
import { storeImage, readStoredImage } from "./vision.js";
import { forkNativeActors } from "./native-fork.js";
import type { TwoCodeBrowserExecutor } from "../browser-contract.js";
import { executeTaskBrowser } from "./browser.js";

export function createTwoCodeService(
  agent: IZCodeAgentService,
  sessions: IZCodeSessionService,
  projectTask?: (task: TwoCodeTask) => Promise<void>,
  browserExecutor?: TwoCodeBrowserExecutor,
): ITwoCodeService {
  const root =
    process.env.TWO_CODE_HOME ??
    (process.platform === "win32" ? "D:/Apps/TwoCode/data" : join(homedir(), ".two-code"));
  const connections = new TwoCodeConnections(root);
  const preferences = new JsonPreferences(root);
  const coordinator = new TwoCodeCoordinator({
    ...(browserExecutor
      ? {
          browser: (task, command, signal) =>
            executeTaskBrowser(browserExecutor, task, command, signal),
        }
      : {}),
    forkActors: (task, at, id) => forkNativeActors(task, at, join(root, "sessions", id)),
    connections: (task) => connections.freeze(task),
    lease: new TaskLease(root),
    store: new JsonTaskStore(join(root, "tasks")),
    sessionRoot: join(root, "sessions"),
    preferences,
    validateWorkspace: async (path) => {
      if (!path || typeof path !== "string") throw new Error("请先选择工作目录");
      const resolved = await realpath(path);
      if (!(await stat(resolved)).isDirectory()) throw new Error("工作目录无效");
      return resolved;
    },
    catalog: async (): Promise<HarnessInfo[]> => {
      const [claude, pi, step] = await Promise.all([
        claudeExecutable(),
        piEntry(),
        stepExecutable(),
      ]);
      return connections.catalog([
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
          models: [],
        },
        {
          id: "step-code",
          name: "Step Code",
          available: !!step,
          detail: step ? "原生Step RPC；API和订阅独立选择" : "未找到Step Code CLI",
          models: [],
        },
      ]);
    },
    createAdapter: (harness) =>
      harness === "claude-code"
        ? new ClaudeAdapter()
        : harness === "step-code"
          ? new StepCodeAdapter()
          : harness === "pi"
            ? new PiAdapter()
            : new ZCodeAdapter(agent, sessions),
  });
  const service: ITwoCodeService = Object.assign(coordinator, {
    combinations: () => preferences.combinations(),
    saveCombination: preferences.saveCombination,
    defaultCombination: preferences.defaultCombination,
    removeCombination: preferences.removeCombination,
    onDidCombinationsChange: preferences.onDidCombinationsChange,
    readImage: (path: string) => readStoredImage(root, path),
    importImage: (input: Parameters<ITwoCodeService["importImage"]>[0]) => storeImage(root, input),
    modelSettings: () => connections.read(),
    saveConnection: (input: Parameters<ITwoCodeService["saveConnection"]>[0]) =>
      connections.save(input),
    removeConnection: (input: Parameters<ITwoCodeService["removeConnection"]>[0]) =>
      connections.remove(input),
    onDidCatalogChange: connections.onDidChange,
    testConnection: (input: Parameters<ITwoCodeService["testConnection"]>[0]) =>
      connections.test(input),
  });
  const disposeCoordinator = service.dispose.bind(service);
  service.dispose = async () => {
    await disposeCoordinator();
    connections.dispose();
    preferences.dispose();
  };
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
