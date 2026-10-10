import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessInfo, TwoCodePreferences, TwoCodeTask } from "@zcode/services";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

const initial: TwoCodePreferences = {
  dual: true,
  lead: { harness: "claude-code" },
  sidekick: { harness: "pi" },
};
export function useTwoCode(
  workspacePath: string,
  activeId: string | null,
  onCreated?: (id: string) => void,
) {
  const service = useWorkspaceServices(workspacePath).twoCodeService;
  const [catalog, setCatalog] = useState<HarnessInfo[]>([]);
  const [preferences, setPreferences] = useState<TwoCodePreferences>(initial);
  const [tasks, setTasks] = useState<TwoCodeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
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
    void Promise.all([service.catalog(), service.preferences(), service.list(workspacePath)])
      .then(([engines, defaults, saved]) => {
        if (!disposed) {
          setCatalog(engines);
          setPreferences(defaults);
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
    };
  }, [service, workspacePath]);
  const submit = async (text: string) => {
    if (!service || sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    try {
      let id = activeId;
      if (!id) {
        await service.configurePreferences(preferences);
        const task = await service.create({ ...preferences, workspacePath });
        id = task.id;
        onCreated?.(id);
        upsert(task);
      }
      const previous = pendingRequest.current;
      const request =
        previous?.taskId === id && previous.text === text
          ? previous
          : { taskId: id, requestId: crypto.randomUUID(), text };
      pendingRequest.current = request;
      upsert(await service.submit(request));
      pendingRequest.current = null;
    } catch (cause) {
      setError(String(cause));
      throw cause;
    } finally {
      sendingRef.current = false;
    }
  };
  const cancel = async () => {
    if (!service || !activeId) return;
    try {
      upsert(await service.cancel(activeId));
    } catch (cause) {
      setError(String(cause));
    }
  };
  const respond = async (permissionId: string, allow: boolean) => {
    if (!service || !activeId) return;
    try {
      await service.respond({ taskId: activeId, permissionId, allow });
    } catch (cause) {
      setError(String(cause));
    }
  };
  return {
    catalog,
    preferences,
    setPreferences,
    tasks,
    task: tasks.find((task) => task.id === activeId),
    activeId,
    loading,
    configuring,
    error,
    submit,
    cancel,
    respond,
    saveDefaults: async (value: TwoCodePreferences) => {
      if (!service) throw new Error("当前宿主未启用 Two Code 服务");
      setPreferences(await service.configurePreferences(value));
    },
    savePreferences: async (value: TwoCodePreferences) => {
      if (!service) return;
      setConfiguring(true);
      try {
        if (activeId) upsert(await service.configure({ taskId: activeId, preferences: value }));
        else setPreferences(await service.configurePreferences(value));
        setError(null);
      } catch (cause) {
        setError(String(cause));
        throw cause;
      } finally {
        setConfiguring(false);
      }
    },
  };
}
