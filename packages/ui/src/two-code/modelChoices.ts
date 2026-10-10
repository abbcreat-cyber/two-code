import type { EngineSelection, HarnessInfo } from "@zcode/services";

export const thinkingLabels: Record<string, string> = {
  "": "默认",
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
export function thinkingOptions(selection: EngineSelection) {
  return selection.harness === "pi"
    ? ["", "off", "minimal", "low", "medium", "high", "xhigh"]
    : selection.harness === "zcode"
      ? ["", "disabled", "enabled", "low", "medium", "high", "xhigh", "max"]
      : ["", "low", "medium", "high", "xhigh", "max"];
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
        (m.provider ?? "") === (current.provider ?? "") &&
        (m.id === current.model ||
          m.aliases?.includes(current.model ?? "") === true ||
          (!current.model && m.id === h.defaultModel)),
    })),
  );
  const selected = choices.find((c) => c.selected);
  if (!selected)
    choices.unshift({
      selection: current,
      name: /^(sonnet|opus|haiku|claude-)/.test(current.model ?? "")
        ? "模型待确认"
        : current.modelLabel || current.model || "选择模型",
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
export function chooseModel(current: EngineSelection, next: EngineSelection): EngineSelection {
  const levels = thinkingOptions(next);
  return {
    ...next,
    thinking: levels.includes(current.thinking ?? "") ? current.thinking : undefined,
  };
}
