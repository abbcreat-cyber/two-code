import { useState } from "react";
import { GitBranch, ChevronDown, UserRound, UsersRound, Bookmark, Check } from "lucide-react";
import type { ActorRole, HarnessInfo, TwoCodePreferences, TwoCodeMode } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import { getZCodeAgentAvailableModes, ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { RoleCard } from "./RoleCard.js";
import { RoleModelPopover } from "./RoleModelPopover.js";
import { thinkingLabels, selectedModelName } from "./modelChoices.js";

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
  const [manage, setManage] = useState<ActorRole | null>(null),
    [draft, setDraft] = useState(value),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const openSettings = useTabStore((s) => s.openSettingsTab);
  const beginManage = (target: ActorRole) => {
    setDraft(structuredClone(value));
    setError("");
    setManage(target);
  };
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
  const roles: ActorRole[] = manage ? [manage] : [];
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
          onManage={() => beginManage(role)}
        />
      ))}
      <Dialog
        open={manage !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setManage(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogTitle>{`${manage === "lead" ? "主手" : "副手"} · 模型与连接`}</DialogTitle>
          <DialogDescription>
            保存后从下一轮生效；更换模型保留当前脚手架的上下文。
          </DialogDescription>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto">
            {roles.map((role) => (
              <div key={role} className="min-w-0 space-y-3">
                <div className="space-y-1 rounded-xl border border-border p-3">
                  <p className="text-ui-caption text-foreground-subtle">
                    {role === "lead" ? "主手" : "副手"} ·{" "}
                    {catalog.find((h) => h.id === draft[role].harness)?.name}
                  </p>
                  <p className="break-words text-ui-base">
                    {selectedModelName(catalog, draft[role])}
                  </p>
                  <p className="text-ui-caption text-foreground-subtle">
                    {draft[role].provider || "本机连接"} · 思考
                    {thinkingLabels[draft[role].thinking ?? ""] ?? draft[role].thinking}
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer rounded-lg px-1 py-2 text-ui-caption text-foreground-subtle">
                    高级配置
                  </summary>
                  <RoleCard
                    role={role}
                    selection={draft[role]}
                    catalog={catalog}
                    disabled={locked || saving}
                    harnessLocked={hasSessions[role]}
                    onChange={(selection) =>
                      setDraft((before) => ({ ...before, [role]: selection }))
                    }
                  />
                </details>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-ui-caption text-foreground-subtle">
              Claude Code、Pi 沿用本机连接与认证。模型目录按脚手架区分，切换时不会自动替换连接。
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setManage(null);
                setPendingSettingsSectionIntent("modelProvider");
                openSettings();
              }}
            >
              打开 ZCode 模型与连接设置
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-ui-caption text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setManage(null)}>
              取消
            </Button>
            <Button
              disabled={locked || saving}
              onClick={() => {
                void save(draft)
                  .then(() => setManage(null))
                  .catch(() => {});
              }}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
