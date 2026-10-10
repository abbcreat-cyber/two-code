import { useState } from "react";
import { GitBranch, ChevronDown, UserRound, UsersRound, Bookmark, Check } from "lucide-react";
import type { ActorRole, HarnessInfo, TwoCodePreferences, TwoCodeMode } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import { getZCodeAgentAvailableModes, ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { openHarnessSettings } from "./settingsNavigation.js";
import { RoleModelPopover } from "./RoleModelPopover.js";

export function TwoCodeModelControls({
  value,
  catalog,
  locked,
  onChange,
  onNative,
  onSaveDefaults,
  hasSessions = {},
}: {
  value: TwoCodePreferences;
  catalog: HarnessInfo[];
  locked: boolean;
  onChange(value: TwoCodePreferences): Promise<void>;
  onNative?: () => void;
  onSaveDefaults(value: TwoCodePreferences): Promise<void>;
  hasSessions?: Partial<Record<ActorRole, boolean>>;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const openSettings = useTabStore((s) => s.openSettingsTab);
  const save = async (next: TwoCodePreferences) => {
    setSaving(true);
    setError("");
    setNotice("");
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
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="group/role-mode gap-1 px-2 text-ui-base"
            data-testid="two-code-mode"
            aria-label={value.dual ? "双角色设置" : "单角色设置"}
            data-composer-collapse-priority="1"
          >
            <GitBranch size={14} />
            <span className="group-data-[composer-compact=true]/role-mode:hidden">
              {value.dual ? "双角色" : "单角色"}
            </span>
            <ChevronDown
              size={12}
              className="group-data-[composer-compact=true]/role-mode:hidden"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-72 gap-0 overflow-hidden p-0"
          data-testid="two-code-collaboration-panel"
        >
          <div className="space-y-2 p-3">
            <p className="text-ui-xs font-medium text-foreground-subtle">当前任务</p>
            <div
              className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1"
              role="group"
              aria-label="角色模式"
            >
              <Button
                variant={value.dual ? "ghost" : "secondary"}
                size="sm"
                className="gap-2"
                aria-pressed={!value.dual}
                disabled={locked || saving}
                onClick={() => {
                  void save({ ...value, dual: false }).catch(() => {});
                }}
              >
                <UserRound className="size-4" />
                {!value.dual && <Check className="size-3" aria-hidden="true" />}
                单角色
              </Button>
              <Button
                variant={value.dual ? "secondary" : "ghost"}
                size="sm"
                className="gap-2"
                aria-pressed={value.dual}
                disabled={locked || saving}
                onClick={() => {
                  void save({ ...value, dual: true }).catch(() => {});
                }}
              >
                <UsersRound className="size-4" />
                {value.dual && <Check className="size-3" aria-hidden="true" />}
                双角色
              </Button>
            </div>
          </div>
          <div className="space-y-1 border-t border-border p-3">
            <p className="mb-2 text-ui-xs font-medium text-foreground-subtle">新任务默认设置</p>
            <Button
              className="w-full justify-start gap-2"
              variant="ghost"
              disabled={locked || saving}
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  await onSaveDefaults(value);
                  setNotice("已保存，以后新建任务使用此配置");
                } catch (cause) {
                  setError(String(cause));
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Bookmark className="size-4" />
              将当前配置设为默认
            </Button>
            <p className="px-2 text-ui-xs text-foreground-subtlest">只影响之后新建的任务</p>
          </div>
          {onNative && (
            <div className="border-t border-border p-1">
              <Button
                className="w-full justify-start"
                variant="ghost"
                disabled={locked || saving}
                onClick={onNative}
              >
                ZCode 原生模式
              </Button>
            </div>
          )}
          {notice && (
            <p role="status" className="px-3 py-2 text-ui-caption text-foreground-subtle">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="px-3 py-2 text-ui-caption text-destructive">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {(["lead", ...(value.dual ? ["sidekick"] : [])] as ActorRole[]).map((role) => (
        <RoleModelPopover
          key={role}
          role={role}
          selection={value[role]}
          catalog={catalog}
          disabled={locked || saving}
          hasSession={hasSessions[role]}
          onChange={(selection) => save({ ...value, [role]: selection })}
          onManage={() => {
            openHarnessSettings(value[role].harness);
            openSettings();
          }}
        />
      ))}
    </>
  );
}
