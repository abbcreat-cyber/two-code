import { useCallback, useEffect, useState } from "react";
import type { HarnessInfo, ModelSettingsView, SaveHarnessConnection } from "@zcode/services";
import { useServices } from "./useServices.js";
export function useTwoCodeModelSettings() {
  const service = useServices().twoCodeService;
  const [view, setView] = useState<ModelSettingsView>(),
    [catalog, setCatalog] = useState<HarnessInfo[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!service) return;
    try {
      const [next, engines] = await Promise.all([service.modelSettings(), service.catalog()]);
      setView(next);
      setCatalog(engines);
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  }, [service]);
  useEffect(() => {
    void refresh();
    const sub = service?.onDidCatalogChange(() => {
      void refresh();
    });
    return () => sub?.dispose();
  }, [service, refresh]);
  return {
    available: !!service,
    view,
    catalog,
    error,
    refresh,
    test: async (id: string, revision: string, modelId: string) => {
      if (!service) throw new Error("模型设置服务不可用");
      return service.testConnection({ id, revision, modelId });
    },
    save: async (input: SaveHarnessConnection) => {
      if (!service) throw new Error("模型设置服务不可用");
      const next = await service.saveConnection(input);
      setView(next);
      return next;
    },
    remove: async (id: string, revision: string) => {
      if (!service) throw new Error("模型设置服务不可用");
      const next = await service.removeConnection({ id, revision });
      setView(next);
      return next;
    },
  };
}
