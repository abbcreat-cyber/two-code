import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessInfo, TwoCodePreferences, TwoCodeTask } from "@zcode/services";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useModelSelectionView } from "@/hooks/useModelSelectionView.js";
import {
  readDraftPreferences,
  saveDraftPreferences,
  clearSubmittedDraftPreferences,
} from "@/two-code/draftPreferences.js";

const initial: TwoCodePreferences = {
  dual: true,
  lead: { harness: "claude-code" },
  sidekick: { harness: "pi" },
};
export function useTwoCode(
  workspacePath: string,
  activeId: string | null,
  onCreated?: (id: string, text: string) => void,
) {
  const service = useWorkspaceServices(workspacePath).twoCodeService;
  const nativeModels = useModelSelectionView(workspacePath);
  const readImage = useCallback(
    async (path: string) => {
      if (!service) throw Error("图片服务不可用");
      return service.readImage(path);
    },
    [service],
  );
  const draftPreferenceKey = `two-code:draft-preferences:${workspacePath}`;
  const [catalog, setCatalog] = useState<HarnessInfo[]>([]);
  const [preferences, setPreferences] = useState<TwoCodePreferences>(initial);
  const [tasks, setTasks] = useState<TwoCodeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const previousActiveId = useRef(activeId);
  const [error, setError] = useState<string | null>(null);
  const [commandErrors, setCommandErrors] = useState<Record<string, string | undefined>>({});
  const commandKey = (id: string | null) => `${workspacePath}:${id ?? "draft"}`;
  const setCommandError = (id: string | null, cause?: unknown) => {
    const key = commandKey(id);
    setCommandErrors((previous) => ({
      ...previous,
      [key]: cause === undefined ? undefined : String(cause),
    }));
  };
  const sendingRef = useRef(false);
  const forkingRef = useRef(false);
  const pendingFork = useRef<{ taskId: string; atSeq: number; requestId: string } | null>(null);
  const pendingRequest = useRef<{ taskId: string; text: string; requestId: string } | null>(null);
  const upsert = useCallback(
    (task: TwoCodeTask) =>
      setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]),
    [],
  );
  useEffect(() => {
    let disposed = false;
    const live = new Map<string, TwoCodeTask>();
    setLoading(true);
    setTasks([]);
    setError(null);
    if (!service) {
      setError("当前宿主未启用 Two Code 服务");
      setLoading(false);
      return;
    }
    const subscription = service.onDidChange((task) => {
      if (disposed) return;
      if (
        task.workspacePath.replaceAll("\\", "/").toLowerCase() !==
        workspacePath.replaceAll("\\", "/").toLowerCase()
      )
        return;
      live.set(task.id, task);
      setTasks((items) => {
        return [task, ...items.filter((item) => item.id !== task.id)];
      });
    });
    const catalogSubscription = service.onDidCatalogChange(() => {
      void service
        .catalog()
        .then((next) => {
          if (!disposed) setCatalog(next);
        })
        .catch((cause) => {
          if (!disposed) setError(String(cause));
        });
    });
    void Promise.all([service.catalog(), service.preferences(), service.list(workspacePath)])
      .then(([engines, defaults, saved]) => {
        if (!disposed) {
          setCatalog(engines);
          setPreferences(readDraftPreferences(localStorage, draftPreferenceKey, defaults));
          // 初始查询在途时仍会收到流式/权限事件；迟到快照不能覆盖已看到的新状态。
          setTasks([
            ...new Map([...saved.map((task) => [task.id, task] as const), ...live]).values(),
          ]);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      subscription.dispose();
      catalogSubscription.dispose();
    };
  }, [service, workspacePath, draftPreferenceKey]);
  useEffect(() => {
    const enteringDraft = previousActiveId.current !== null && activeId === null;
    previousActiveId.current = activeId;
    setDefaultsLoading(false);
    if (!enteringDraft || !service) return;
    let disposed = false;
    setDefaultsLoading(true);
    // 新草稿重新读取已保存默认值；上一个任务的临时选项不能成为隐式全局设置。
    void service
      .preferences()
      .then((value) => {
        if (!disposed)
          setPreferences(readDraftPreferences(localStorage, draftPreferenceKey, value));
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      })
      .finally(() => {
        if (!disposed) setDefaultsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeId, service, draftPreferenceKey]);
  const submit = async (text: string, draftText = text) => {
    if (!service || sendingRef.current) return;
    sendingRef.current = true;
    setCommandError(activeId);
    let id = activeId;
    try {
      if (!id) {
        const task = await service.create({ ...preferences, workspacePath });
        id = task.id;
        clearSubmittedDraftPreferences(localStorage, draftPreferenceKey, preferences);
        onCreated?.(id, draftText);
        upsert(task);
      }
      setCommandError(id);
      const previous = pendingRequest.current;
      const request =
        previous?.taskId === id && previous.text === text
          ? previous
          : { taskId: id, requestId: crypto.randomUUID(), text };
      pendingRequest.current = request;
      upsert(await service.submit(request));
      pendingRequest.current = null;
      return id;
    } catch (cause) {
      // 新建后的发送失败属于已创建任务；异步回包不能污染用户切换后的视图。
      setCommandError(id, cause);
      throw cause;
    } finally {
      sendingRef.current = false;
    }
  };
  const cancel = async () => {
    if (!service || !activeId) return;
    try {
      upsert(await service.cancel(activeId));
      setCommandError(activeId);
    } catch (cause) {
      setCommandError(activeId, cause);
    }
  };
  const respond = async (permissionId: string, allow: boolean) => {
    if (!service || !activeId) return;
    try {
      await service.respond({ taskId: activeId, permissionId, allow });
      setCommandError(activeId);
    } catch (cause) {
      setCommandError(activeId, cause);
    }
  };
  return {
    catalog: catalog.map((h) =>
      h.id === "zcode" && nativeModels.state.status === "ready"
        ? {
            ...h,
            defaultModel: nativeModels.state.view.preferredSelection?.modelId,
            defaultProvider: nativeModels.state.view.preferredSelection?.providerId,
            models: nativeModels.state.view.providers
              .filter((p) => !!p.config.api?.type)
              .flatMap((p) =>
                p.models.map((m) => ({ id: m.modelId, provider: p.providerId, name: m.modelId })),
              ),
          }
        : h,
    ),
    preferences,
    setPreferences,
    tasks,
    task: tasks.find((task) => task.id === activeId),
    activeId,
    loading,
    configuring: configuring || defaultsLoading,
    error: commandErrors[commandKey(activeId)] || error,
    submit,
    readImage,
    importImage: service ? service.importImage.bind(service) : undefined,
    cancel,
    respond,
    fork: async (atSeq: number) => {
      if (!service || !activeId || configuring || forkingRef.current) return;
      forkingRef.current = true;
      setConfiguring(true);
      try {
        const previous = pendingFork.current;
        const request =
          previous?.taskId === activeId && previous.atSeq === atSeq
            ? previous
            : { taskId: activeId, atSeq, requestId: crypto.randomUUID() };
        pendingFork.current = request;
        const branch = await service.fork(request);
        pendingFork.current = null;
        upsert(branch);
        setCommandError(activeId);
        return branch.id;
      } catch (cause) {
        setCommandError(activeId, cause);
      } finally {
        forkingRef.current = false;
        setConfiguring(false);
      }
    },
    saveDefaults: async (value: TwoCodePreferences) => {
      if (!service) throw new Error("当前宿主未启用 Two Code 服务");
      // 默认配置由服务拥有，不回填可能已切换到别处的当前草稿。
      await service.configurePreferences(value);
    },
    savePreferences: async (value: TwoCodePreferences) => {
      if (!service) return;
      setConfiguring(true);
      try {
        if (activeId) upsert(await service.configure({ taskId: activeId, preferences: value }));
        else {
          saveDraftPreferences(localStorage, draftPreferenceKey, value);
          setPreferences(value);
        }
        setCommandError(activeId);
      } catch (cause) {
        setCommandError(activeId, cause);
        throw cause;
      } finally {
        setConfiguring(false);
      }
    },
  };
}
