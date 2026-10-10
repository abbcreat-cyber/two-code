import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessInfo, TwoCodePreferences, TwoCodeTask } from "@zcode/services";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

const initial: TwoCodePreferences = {
  dual: true,
  lead: { harness: "claude-code" },
  sidekick: { harness: "pi" },
};
export function useTwoCode(workspacePath: string) {
  const service = useWorkspaceServices(workspacePath).twoCodeService;
  const [catalog, setCatalog] = useState<HarnessInfo[]>([]);
  const [preferences, setPreferences] = useState<TwoCodePreferences>(initial);
  const [tasks, setTasks] = useState<TwoCodeTask[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const sendingRef = useRef(false);
  const pendingRequest = useRef<{ taskId: string; text: string; requestId: string } | null>(null);
  const upsert = useCallback(
    (task: TwoCodeTask) =>
      setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]),
    [],
  );
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setTasks([]);
    setActiveId(null);
    setError(null);
    if (!service) {
      setError("当前宿主未启用 Two Code 服务");
      setLoading(false);
      return;
    }
    const subscription = service.onDidChange((task) => {
      if (disposed) return;
      setTasks((items) => {
        if (task.id !== activeRef.current && !items.some((item) => item.id === task.id))
          return items;
        return [task, ...items.filter((item) => item.id !== task.id)];
      });
    });
    void Promise.all([service.catalog(), service.preferences(), service.list(workspacePath)])
      .then(([engines, defaults, saved]) => {
        if (!disposed) {
          setCatalog(engines);
          setPreferences(defaults);
          setTasks(saved);
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
        activeRef.current = id;
        setActiveId(id);
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
    select: setActiveId,
    newTask: () => setActiveId(null),
    loading,
    error,
    submit,
    cancel,
    respond,
  };
}
