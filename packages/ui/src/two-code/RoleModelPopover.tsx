import { useState } from "react";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import type { ActorRole, EngineSelection, HarnessInfo } from "@zcode/services";
import { normalizeThinkingSelection } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  chooseModel,
  modelChoices,
  selectedModelName,
  thinkingLabels,
  thinkingOptions,
} from "./modelChoices.js";

export function RoleModelPopover({
  role,
  selection,
  catalog,
  disabled,
  hasSession,
  none = false,
  onNone,
  onChange,
  onManage,
}: {
  role: ActorRole;
  selection: EngineSelection;
  catalog: HarnessInfo[];
  disabled: boolean;
  hasSession?: boolean;
  none?: boolean;
  onNone?: () => Promise<void>;
  onChange(selection: EngineSelection): Promise<void>;
  onManage(): void;
}) {
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const label = role === "lead" ? "主手" : "副手";
  const levels = thinkingOptions(selection, catalog);
  const thinking = normalizeThinkingSelection(selection, catalog).thinking;
  const harness = catalog.find((h) => h.id === selection.harness);
  const candidates = modelChoices(catalog, selection);
  const compatible = candidates.filter((m) => m.selection.harness === selection.harness);
  const apply = async (operation: () => Promise<void>, close: boolean) => {
    setSaving(true);
    setError("");
    try {
      await operation();
      if (close) setOpen(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  const save = (next: EngineSelection, close: boolean) =>
    apply(() => onChange(normalizeThinkingSelection(next, catalog)), close);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setError("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || saving}
          data-testid={`two-code-${role}-model`}
          className="group/role-model min-w-0 gap-1 px-2 text-ui-base"
          data-composer-collapse-priority="3"
          title={
            none
              ? "副手 · 无"
              : `${label} · ${harness?.name ?? selection.harness} · ${selection.provider || "本机连接"} · ${selection.model || "本机模型"} · 思考${thinkingLabels[thinking ?? ""] ?? "未收录"}`
          }
        >
          <span className="shrink-0 text-foreground-subtle">{label}</span>
          <span className="max-w-40 truncate group-data-[composer-compact=true]/role-model:max-w-24 group-data-[composer-model-icon=true]/toolbar:hidden">
            {none ? "无" : selectedModelName(catalog, selection)}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0"
        collisionPadding={12}
        sideOffset={8}
        data-testid={`two-code-${role}-panel`}
      >
        <div className="shrink-0 space-y-3 border-b border-border p-3">
          <p className="text-ui-base font-medium">{label}设置</p>
          <label className="flex items-center justify-between gap-3 text-ui-caption text-foreground-subtle">
            脚手架
            <Select
              disabled={disabled || saving || hasSession}
              value={selection.harness}
              onValueChange={(id) => {
                const next = catalog.find((h) => h.id === id);
                if (!next) return;
                const first =
                  next.models.find(
                    (m) => m.id === next.defaultModel && m.provider === next.defaultProvider,
                  ) ?? next.models[0];
                void save(
                  {
                    harness: next.id,
                    model: first?.id,
                    provider: first?.provider,
                    modelLabel: first?.name,
                  },
                  false,
                );
              }}
            >
              <SelectTrigger aria-label={`${label}脚手架`} className="max-w-48" size="lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((h) => (
                  <SelectItem key={h.id} value={h.id} disabled={!h.available}>
                    {h.name}
                    {h.available ? "" : "（未安装）"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {hasSession && (
            <p className="text-ui-xs text-foreground-subtlest">
              换模型保留上下文；换脚手架请新建任务。
            </p>
          )}
        </div>
        <div
          className="min-h-0 max-h-60 flex-1 overflow-y-auto p-1"
          role="listbox"
          aria-label={`${label}模型列表`}
        >
          {onNone && (
            <button
              type="button"
              role="option"
              aria-selected={none}
              data-testid="two-code-sidekick-none"
              disabled={disabled || saving}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-50"
              onClick={() => void apply(onNone, true)}
            >
              <span className="flex-1 text-ui-base">无</span>
              {none && <Check className="size-4 shrink-0" />}
            </button>
          )}
          {compatible.map((m) => (
            <button
              key={`${m.selection.provider}/${m.selection.model}`}
              type="button"
              role="option"
              aria-selected={!none && m.selected}
              data-model-id={m.selection.model}
              data-model-provider={m.selection.provider ?? ""}
              title={`${m.connection} · ${m.selection.model ?? "默认"}`}
              disabled={disabled || saving || !m.available}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-50"
              onClick={() => void save(chooseModel(selection, m.selection, catalog), true)}
            >
              <span className="min-w-0 flex-1 break-words text-ui-base">{m.name}</span>
              {!none && m.selected && <Check className="size-4 shrink-0" />}
            </button>
          ))}
          {!compatible.length && (
            <p className="p-3 text-ui-caption text-foreground-subtle">当前脚手架没有匹配模型</p>
          )}
        </div>
        <label className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3 text-ui-caption text-foreground-subtle">
          思考档位
          <Select
            value={levels.length ? thinking : ""}
            disabled={disabled || saving || none || !levels.length}
            onValueChange={(level) => void save({ ...selection, thinking: level }, false)}
          >
            <SelectTrigger aria-label={`${label}思考档位`} className="min-w-32" size="lg">
              <SelectValue placeholder="未收录" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
              align="end"
              sideOffset={6}
              className="min-w-36"
            >
              {levels.map((level) => (
                <SelectItem key={level} value={level} title={level}>
                  {thinkingLabels[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {error && (
          <p role="alert" className="px-3 pb-2 text-ui-caption text-destructive">
            {error}
          </p>
        )}
        <div className="shrink-0 border-t border-border p-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings2 className="size-4" />
            管理模型与连接…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
