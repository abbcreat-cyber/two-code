import type { HarnessInfo, TwoCodeMode, TwoCodePreferences } from "@zcode/services";
import { normalizeThinkingSelection } from "@zcode/services";
import { getZCodeAgentAvailableModes, ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ZCODE_MODE_OPTION_LABEL_IDS } from "@/chat-input-toolbar/display-help.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { chooseModel, modelChoices, thinkingLabels, thinkingOptions } from "./modelChoices.js";

export function CombinationEditor({
  value,
  catalog,
  disabled,
  onChange,
}: {
  value: TwoCodePreferences;
  catalog: HarnessInfo[];
  disabled: boolean;
  onChange(value: TwoCodePreferences): void;
}) {
  const { intl } = useZCodeIntl();
  const modes = getZCodeAgentAvailableModes();
  return (
    <div className="space-y-3" data-testid="two-code-combination-editor">
      <div className="divide-y divide-border rounded-lg border border-border">
        {(["lead", "sidekick"] as const).map((role) => {
          const label = role === "lead" ? "主手" : "副手";
          const selection = value[role];
          const choices = modelChoices(catalog, selection);
          const none = role === "sidekick" && !value.dual;
          const levels = thinkingOptions(selection, catalog);
          const thinking = normalizeThinkingSelection(selection, catalog).thinking;
          return (
            <div key={role} className="min-w-0 space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui-caption font-medium">{label}</span>
                <Select
                  value={levels.length ? thinking : ""}
                  disabled={disabled || none || !levels.length}
                  onValueChange={(level) => {
                    if (levels.includes(level))
                      onChange({ ...value, [role]: { ...selection, thinking: level } });
                  }}
                >
                  <SelectTrigger aria-label={`自定义${label}思考档位`} variant="ghost" size="sm">
                    <span className="text-ui-xs text-foreground-subtle">思考</span>
                    <SelectValue placeholder="未收录" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    {levels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {thinkingLabels[level] ?? level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select
                value={none ? "none" : String(choices.findIndex((c) => c.selected))}
                disabled={disabled}
                onValueChange={(id) => {
                  // Radix注册选项时可能发出空值，不能把空值转成0而误选第一个模型。
                  if (!id) return;
                  if (id === "none") {
                    onChange({ ...value, dual: false });
                    return;
                  }
                  const next = choices[Number(id)];
                  if (next)
                    onChange({
                      ...value,
                      ...(role === "sidekick" ? { dual: true } : {}),
                      [role]: chooseModel(selection, next.selection),
                    });
                }}
              >
                <SelectTrigger
                  aria-label={`自定义${label}模型`}
                  className="w-full min-w-0"
                  size="lg"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  className="max-h-72 max-w-[calc(100vw-2rem)]"
                >
                  {role === "sidekick" && <SelectItem value="none">无</SelectItem>}
                  {Array.from(new Set(choices.map((c) => c.selection.harness))).map((harness) => (
                    <SelectGroup key={harness}>
                      <SelectLabel className="text-ui-xs">
                        {catalog.find((h) => h.id === harness)?.name ?? harness}
                      </SelectLabel>
                      {choices.map(
                        (choice, index) =>
                          choice.selection.harness === harness && (
                            <SelectItem
                              key={index}
                              value={String(index)}
                              disabled={!choice.available}
                              data-model-id={choice.selection.model}
                              data-model-provider={choice.selection.provider ?? ""}
                              data-model-harness={harness}
                              title={`${choice.harnessName} · ${choice.connection} · ${choice.selection.model ?? "默认"}`}
                            >
                              <span className="min-w-0 truncate">{choice.name}</span>
                              <span className="text-ui-xs text-foreground-subtlest">
                                {choice.harnessName}
                              </span>
                            </SelectItem>
                          ),
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-caption text-foreground-subtle">权限模式</span>
        <Select
          value={value.mode ?? "build"}
          disabled={disabled}
          onValueChange={(mode) => {
            if (modes.some((m) => m.id === mode)) onChange({ ...value, mode: mode as TwoCodeMode });
          }}
        >
          <SelectTrigger aria-label="自定义权限模式" variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {modes.map((mode) => (
              <SelectItem key={mode.id} value={mode.id}>
                {intl.formatMessage({
                  id: ZCODE_MODE_OPTION_LABEL_IDS[ZCODE_AGENT_PROVIDER][mode.id] ?? mode.name,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
