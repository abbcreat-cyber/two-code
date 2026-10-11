import type { EngineSelection, HarnessInfo } from "@zcode/services";
import { selectionThinkingProfile, normalizeThinkingSelection } from "@zcode/services";

export const thinkingLabels: Record<string, string> = {
  none: "关闭",
  off: "关闭",
  disabled: "关闭",
  enabled: "开启",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};
export function thinkingOptions(selection: EngineSelection, catalog: HarnessInfo[] = []) {
  return selectionThinkingProfile(selection, catalog)?.levels ?? [];
}
export function sameModel(a: EngineSelection, b: EngineSelection) {
  return (
    a.harness === b.harness &&
    (a.provider ?? "") === (b.provider ?? "") &&
    (a.model ?? "") === (b.model ?? "")
  );
}
export function modelChoices(catalog: HarnessInfo[], current: EngineSelection) {
  const choices: Array<{
    selection: EngineSelection;
    name: string;
    connection: string;
    available: boolean;
    harnessName: string;
    selected: boolean;
  }> = catalog.flatMap((h) =>
    h.models.map((m) => ({
      selection: {
        harness: h.id,
        model: m.id,
        provider: m.provider,
        modelLabel: m.name,
      } satisfies EngineSelection,
      name: m.name,
      connection: m.provider || `${h.name} 本机连接`,
      available: h.available,
      harnessName: h.name,
      selected:
        h.id === current.harness &&
        (m.provider ?? "") ===
          (current.provider ?? (!current.model ? h.defaultProvider : undefined) ?? "") &&
        (m.id === current.model ||
          m.aliases?.includes(current.model ?? "") === true ||
          (!current.model && m.id === h.defaultModel)),
    })),
  );
  const selected = choices.find((c) => c.selected);
  if (!selected)
    choices.unshift({
      selection: current,
      name: current.modelLabel || current.model || "沿用本机模型",
      connection: current.provider || "本机连接",
      available: true,
      harnessName: catalog.find((h) => h.id === current.harness)?.name || current.harness,
      selected: true,
    });
  return choices;
}
export function selectedModelName(catalog: HarnessInfo[], selection: EngineSelection): string {
  return modelChoices(catalog, selection).find((m) => m.selected)!.name;
}
export function chooseModel(
  current: EngineSelection,
  next: EngineSelection,
  catalog: HarnessInfo[] = [],
): EngineSelection {
  return normalizeThinkingSelection(
    {
      ...next,
      thinking: current.thinking,
    },
    catalog,
  );
}
