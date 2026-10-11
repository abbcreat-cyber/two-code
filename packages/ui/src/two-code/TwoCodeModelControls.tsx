import { useState } from "react";
import { GitBranch, ChevronDown } from "lucide-react";
import type { ActorRole, HarnessInfo, TwoCodePreferences, TwoCodeMode } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import { getZCodeAgentAvailableModes, ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { openHarnessSettings } from "./settingsNavigation.js";
import { RoleModelPopover } from "./RoleModelPopover.js";
import { CombinationPicker } from "./CombinationPicker.js";

export function TwoCodeModelControls({
  value,
  workspacePath,
  catalog,
  locked,
  onChange,
  hasSessions = {},
}: {
  value: TwoCodePreferences;
  workspacePath: string;
  catalog: HarnessInfo[];
  locked: boolean;
  onChange(value: TwoCodePreferences): Promise<void>;
  hasSessions?: Partial<Record<ActorRole, boolean>>;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  const openSettings = useTabStore((s) => s.openSettingsTab);
  const save = async (next: TwoCodePreferences) => {
    setSaving(true);
    setError("");
    try {
      await onChange(next);
    } catch (cause) {
      setError(String(cause));
      throw cause;
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ConfigSelect
        option={{
          id: "mode",
          name: "模式",
          category: "mode",
          type: "select",
          currentValue: value.mode ?? "build",
          options: [...getZCodeAgentAvailableModes()]
            .sort(
              (a, b) =>
                ["plan", "build", "edit", "yolo"].indexOf(a.id) -
                ["plan", "build", "edit", "yolo"].indexOf(b.id),
            )
            .map((m) => ({ value: m.id, name: m.name })),
        }}
        provider={ZCODE_AGENT_PROVIDER}
        onValueChange={(mode) => {
          void save({ ...value, mode: mode as TwoCodeMode }).catch(() => {});
        }}
        disabled={locked || saving}
        tooltipTitle="权限模式"
        triggerSize="sm"
        labelVisibilityClassName="inline-flex"
        restoreFocusSelector='[data-testid="two-code-composer"]'
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="group/role-mode gap-1 px-2 text-ui-base"
            data-testid="two-code-mode"
            aria-label="AI 组合"
            data-composer-collapse-priority="1"
          >
            <GitBranch size={14} />
            <span className="group-data-[composer-compact=true]/role-mode:hidden">组合</span>
            <ChevronDown
              size={12}
              className="group-data-[composer-compact=true]/role-mode:hidden"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="max-h-[var(--radix-popover-content-available-height)] w-88 max-w-[calc(100vw-1.5rem)] gap-0 overflow-y-auto p-0"
          data-testid="two-code-collaboration-panel"
        >
          <CombinationPicker
            workspacePath={workspacePath}
            value={value}
            catalog={catalog}
            locked={locked || saving}
            hasSessions={hasSessions}
            onApply={async (next) => {
              setError("");
              await onChange(next);
              setOpen(false);
            }}
          />
          {error && (
            <p role="alert" className="px-3 py-2 text-ui-caption text-destructive">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {(["lead", "sidekick"] as ActorRole[]).map((role) => (
        <RoleModelPopover
          key={role}
          role={role}
          selection={value[role]}
          catalog={catalog}
          disabled={locked || saving}
          hasSession={hasSessions[role]}
          none={role === "sidekick" && !value.dual}
          onNone={role === "sidekick" ? () => save({ ...value, dual: false }) : undefined}
          onChange={(selection) =>
            save({ ...value, ...(role === "sidekick" ? { dual: true } : {}), [role]: selection })
          }
          onManage={() => {
            openHarnessSettings(value[role].harness);
            openSettings();
          }}
        />
      ))}
    </>
  );
}
