import { useCallback, useEffect, useRef, useState } from "react";
import type { TwoCodeCombinations, TwoCodePreferences } from "@zcode/services";
import { useWorkspaceServices } from "./useWorkspaceServices.js";

export function useTwoCodeCombinations(workspacePath: string) {
  const service = useWorkspaceServices(workspacePath).twoCodeService;
  const [view, setView] = useState<TwoCodeCombinations>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const accept = useCallback(
    (next: TwoCodeCombinations) =>
      setView((old) => (!old || next.revision >= old.revision ? next : old)),
    [],
  );
  const refresh = useCallback(async () => {
    if (!service) return;
    try {
      accept(await service.combinations());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [service, accept]);
  useEffect(() => {
    setView(undefined);
    setError("");
    if (!service) return;
    let disposed = false;
    const sub = service.onDidCombinationsChange((next) => {
      if (!disposed) accept(next);
    });
    void service
      .combinations()
      .then((next) => {
        if (!disposed) accept(next);
      })
      .catch((e) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      disposed = true;
      sub.dispose();
    };
  }, [service, accept]);
  const run = async (operation: (revision: number) => Promise<TwoCodeCombinations>) => {
    if (!service || !view || working.current) throw Error("组合正在加载或保存，请稍候");
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await operation(view.revision);
      accept(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
      throw e;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return {
    view,
    busy,
    error,
    refresh,
    save: (input: { id?: string; name: string; preferences?: TwoCodePreferences }) =>
      run((revision) => service!.saveCombination({ ...input, revision })),
    makeDefault: (id: string) => run((revision) => service!.defaultCombination({ id, revision })),
    remove: (id: string) => run((revision) => service!.removeCombination({ id, revision })),
  };
}
