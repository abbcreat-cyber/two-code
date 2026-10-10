interface ThinkingSelection {
  harness: string;
  provider?: string;
  model?: string;
  modelLabel?: string;
  thinking?: string;
}
interface ThinkingHarness {
  id: string;
  models: Array<{
    id: string;
    provider?: string;
    name: string;
    realModel?: string;
    aliases?: string[];
  }>;
}

export interface ModelThinkingProfile {
  id: string;
  aliases: string[];
  levels: string[];
  initial: string;
  source: string;
}
const openai = "https://developers.openai.com/api/docs/models/";
/** 官方文档快照，核对日期2026-10-10。更新资料时同步spec中的来源表。 */
export const modelThinkingProfiles: readonly ModelThinkingProfile[] = [
  ...["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"].map((id) => ({
    id,
    aliases: [id],
    levels: [
      ...(["gpt-6-sol", "gpt-6-luna"].includes(id) ? ["none"] : []),
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ],
    initial: "medium",
    source: openai + id,
  })),
  ...["glm-5.3", "glm-5.3-flash"].map((id) => ({
    id,
    aliases: [id],
    levels: ["low", "high", "max"],
    initial: "max",
    source: "https://github.com/zai-org/GLM-5#note",
  })),
  {
    id: "deepseek-v4.1-flash",
    aliases: ["deepseek-v4.1-flash", "deepseek-flash", "ds-v4.1-flash"],
    levels: ["none", "low", "high", "max"],
    initial: "high",
    source: "https://api-docs.deepseek.com/guides/thinking_mode/",
  },
  ...["pro", "flash"].map((kind) => ({
    id: `mimo-v2.6-${kind}`,
    aliases: [`mimo-v2.6-${kind}`, `claude-mimo-2-6-${kind}`],
    levels: ["disabled", "enabled"],
    initial: "enabled",
    source: "https://mimo.mi.com/docs/en-US/api/chat/responses",
  })),
];
const identity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function findModelThinkingProfile(...identifiers: (string | undefined)[]) {
  for (const value of identifiers) {
    if (!value) continue;
    const key = identity(value);
    const profile = modelThinkingProfiles.find((p) =>
      p.aliases.some((a) => key.startsWith(identity(a))),
    );
    if (profile) return profile;
  }
}
export function selectionThinkingProfile(
  selection: ThinkingSelection,
  catalog: ThinkingHarness[] = [],
) {
  const match = catalog
    .find((h) => h.id === selection.harness)
    ?.models.find(
      (m) =>
        (m.provider ?? "") === (selection.provider ?? "") &&
        (m.id === selection.model || m.aliases?.includes(selection.model ?? "")),
    );
  return findModelThinkingProfile(
    match?.realModel,
    match?.id,
    selection.model,
    match?.name,
    selection.modelLabel,
  );
}
export function normalizeThinkingSelection<T extends ThinkingSelection>(
  selection: T,
  catalog: ThinkingHarness[] = [],
): T {
  const profile = selectionThinkingProfile(selection, catalog);
  if (!profile) return selection;
  let value = selection.thinking;
  if (value === "off" || value === "disabled" || value === "none")
    value = profile.levels.includes("disabled") ? "disabled" : "none";
  if (profile.id.startsWith("mimo-")) value = value === "disabled" ? "disabled" : "enabled";
  else if (profile.id.startsWith("deepseek-"))
    value =
      ({ minimal: "low", medium: "high", xhigh: "high", ultra: "max" } as Record<string, string>)[
        value ?? ""
      ] ?? value;
  else if (
    profile.id.startsWith("gpt-") &&
    ["minimal", "none"].includes(value ?? "") &&
    !profile.levels.includes(value!)
  )
    value = "low";
  return { ...selection, thinking: profile.levels.includes(value ?? "") ? value : profile.initial };
}
export function normalizeTaskThinking(
  task: { lead: { selection: ThinkingSelection }; sidekick: { selection: ThinkingSelection } },
  catalog: ThinkingHarness[],
) {
  for (const role of ["lead", "sidekick"] as const)
    task[role].selection = normalizeThinkingSelection(task[role].selection, catalog);
}
export function piThinkingLevel(value: string) {
  return value === "none" || value === "disabled" ? "off" : value === "enabled" ? "high" : value;
}
export function piThinkingMetadata(
  id: string,
  name: string,
  api: string,
): {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  compat?: { thinkingFormat: string; supportsReasoningEffort: boolean };
} {
  const profile = findModelThinkingProfile(id, name);
  if (!profile) return {};
  const map: Record<string, string | null> = {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  };
  for (const level of profile.levels)
    map[piThinkingLevel(level)] = ["none", "disabled"].includes(level)
      ? "none"
      : level === "enabled"
        ? "high"
        : level;
  const format = profile.id.startsWith("glm-")
    ? "zai"
    : /^(deepseek|mimo)-/.test(profile.id)
      ? "deepseek"
      : undefined;
  return {
    reasoning: true,
    thinkingLevelMap: map,
    ...(api === "openai-completions" && format
      ? {
          compat: {
            thinkingFormat: format,
            supportsReasoningEffort: !profile.id.startsWith("mimo-"),
          },
        }
      : {}),
  };
}
