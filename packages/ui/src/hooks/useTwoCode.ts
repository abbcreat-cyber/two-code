import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HarnessInfo,
  TwoCodePreferences,
  TwoCodeTask,
  TwoCodeViewFrame,
  TwoCodeViewSnapshot,
} from "@zcode/services";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { applyTwoCodeView } from "@/two-code/conversationView.js";
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
const emptyRows: ConversationRow[] = [];
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
  const [rowsByTask, setRowsByTask] = useState(new Map<string, ConversationRow[]>());
  const refreshView = useRef<(id: string) => Promise<void>>(async () => {});
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
  const upsert = useCallback((task: TwoCodeTask) => {
    void refreshView.current(task.id);
  }, []);
  useEffect(() => {
    let disposed = false;
    const views = new Map<string, TwoCodeViewSnapshot>();
    const pending = new Map<string, Promise<void>>();
    const wanted = new Map<string, { epoch: string; revision: number }>();
    setLoading(true);
    setTasks([]);
    setRowsByTask(new Map());
    setError(null);
    if (!service) {
      setError("当前宿主未启用 Two Code 服务");
      setLoading(false);
      return;
    }
    const receive = (frame: TwoCodeViewFrame, authoritative = false) => {
      if (disposed) return;
      const id = frame.kind === "snapshot" ? frame.task.id : frame.taskId;
      const path = frame.kind === "snapshot" ? frame.task.workspacePath : frame.workspacePath;
      if (
        path.replaceAll("\\", "/").toLowerCase() !==
        workspacePath.replaceAll("\\", "/").toLowerCase()
      )
        return;
      const previous = views.get(id);
      const next = applyTwoCodeView(previous, frame, authoritative);
      if (!next) {
        const epoch = frame.kind === "snapshot" ? frame.snapshot.logEpoch : frame.epoch;
        const revision = frame.kind === "snapshot" ? frame.snapshot.revision : frame.revision;
        const last = wanted.get(id);
        if (!last || last.epoch !== epoch || last.revision < revision)
          wanted.set(id, { epoch, revision });
        void refresh(id);
        return;
      }
      const target = wanted.get(id);
      if (
        authoritative &&
        target &&
        (next.snapshot.logEpoch !== target.epoch || next.snapshot.revision >= target.revision)
      )
        wanted.delete(id);
      if (next === previous) return;
      views.set(id, next);
      setRowsByTask((old) => new Map(old).set(id, next.snapshot.rows.window));
      if (next.task !== previous?.task)
        setTasks((items) => [next.task, ...items.filter((item) => item.id !== id)]);
    };
    const refresh = (id: string, attempt = 0): Promise<void> => {
      const existing = pending.get(id);
      if (existing) return existing;
      const work = service
        .readView(id)
        .then((frame) => receive(frame, true))
        .catch((cause) => {
          wanted.delete(id);
          if (!disposed) setError(String(cause));
        })
        .finally(() => {
          pending.delete(id);
          // 补快照在途时也可能丢掉最后一帧，不能等下一 token 才发现终态没追上。
          if (!disposed && wanted.has(id)) {
            if (attempt < 2) void refresh(id, attempt + 1);
            else {
              wanted.delete(id);
              setError("会话视图同步未追上，请重新打开任务");
            }
          }
        });
      pending.set(id, work);
      return work;
    };
    refreshView.current = refresh;
    const subscription = service.onDidViewChange((frame) => receive(frame));
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
    void Promise.all([service.catalog(), service.preferences(), service.listViews(workspacePath)])
      .then(([engines, defaults, saved]) => {
        if (!disposed) {
          setCatalog(engines);
          setPreferences(readDraftPreferences(localStorage, draftPreferenceKey, defaults));
          // 原版 snapshot/revision 语义：初始回包也经过同一水位检查。
          for (const frame of saved) receive(frame);
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
      refreshView.current = async () => {};
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
    rows: rowsByTask.get(activeId ?? "") ?? emptyRows,
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
