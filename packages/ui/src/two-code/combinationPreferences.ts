import type { ActorRole, HarnessInfo, TwoCodePreferences } from "@zcode/services";
import { normalizeThinkingSelection } from "@zcode/services";
import { modelChoices, sameModel } from "./modelChoices.js";

export function combinationSelection(
  value: TwoCodePreferences,
  role: ActorRole,
  catalog: HarnessInfo[],
) {
  const selected = modelChoices(catalog, value[role]).find((m) => m.selected)!;
  return normalizeThinkingSelection(
    { ...selected.selection, thinking: value[role].thinking },
    catalog,
  );
}
export function normalizeCombination(
  value: TwoCodePreferences,
  catalog: HarnessInfo[],
): TwoCodePreferences {
  return {
    ...value,
    lead: combinationSelection(value, "lead", catalog),
    sidekick: combinationSelection(value, "sidekick", catalog),
  };
}
export function matchesCombination(
  a: TwoCodePreferences,
  b: TwoCodePreferences,
  catalog: HarnessInfo[],
) {
  if (a.dual !== b.dual || (a.mode ?? "build") !== (b.mode ?? "build")) return false;
  return (a.dual ? (["lead", "sidekick"] as const) : (["lead"] as const)).every((role) => {
    const left = combinationSelection(a, role, catalog),
      right = combinationSelection(b, role, catalog);
    return sameModel(left, right) && (left.thinking ?? "") === (right.thinking ?? "");
  });
}
