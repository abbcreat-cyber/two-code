import { useState } from "react";
import { Check, ChevronDown, Settings2, Search } from "lucide-react";
import type { ActorRole, EngineSelection, HarnessInfo } from "@zcode/services";
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
  onChange,
  onManage,
}: {
  role: ActorRole;
  selection: EngineSelection;
  catalog: HarnessInfo[];
  disabled: boolean;
  hasSession?: boolean;
  onChange(selection: EngineSelection): Promise<void>;
  onManage(): void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const label = role === "lead" ? "主手" : "副手";
  const harness = catalog.find((h) => h.id === selection.harness);
  const candidates = modelChoices(catalog, selection).filter((m) =>
    `${m.name} ${m.selection.model} ${m.connection}`.toLowerCase().includes(query.toLowerCase()),
  );
  const compatible = candidates.filter((m) => m.selection.harness === selection.harness);
  const save = async (next: EngineSelection, close: boolean) => {
    setSaving(true);
    setError("");
    try {
      await onChange(next);
      if (close) setOpen(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setQuery("");
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
          title={`${label} · ${harness?.name ?? selection.harness} · ${selection.provider || "本机连接"} · ${selection.model || "默认模型"} · 思考${thinkingLabels[selection.thinking ?? ""] ?? selection.thinking}`}
        >
          <span className="shrink-0 text-foreground-subtle">{label}</span>
          <span className="max-w-40 truncate group-data-[composer-compact=true]/role-model:max-w-24 group-data-[composer-model-icon=true]/toolbar:hidden">
            {selectedModelName(catalog, selection)}
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
                    {h.name}{h.available ? "" : "（未安装）"}
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
          <div className="flex items-center gap-2 rounded-lg border border-input-border bg-input px-2">
            <Search className="size-3.5 text-foreground-subtle" />
            <input
              aria-label={`${label}搜索模型`}
              placeholder="搜索模型"
              className="h-8 min-w-0 flex-1 bg-transparent text-ui-base outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div
          className="min-h-0 max-h-60 flex-1 overflow-y-auto p-1"
          role="listbox"
          aria-label={`${label}模型列表`}
        >
          {compatible.map((m) => (
            <button
              key={`${m.selection.provider}/${m.selection.model}`}
              type="button"
              role="option"
              aria-selected={m.selected}
              data-model-id={m.selection.model}
              data-model-provider={m.selection.provider ?? ""}
              title={`${m.connection} · ${m.selection.model ?? "默认"}`}
              disabled={disabled || saving || !m.available}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-50"
              onClick={() => void save(chooseModel(selection, m.selection), true)}
            >
              <span className="min-w-0 flex-1 break-words text-ui-base">{m.name}</span>
              {m.selected && <Check className="size-4 shrink-0" />}
            </button>
          ))}
          {!compatible.length && (
            <p className="p-3 text-ui-caption text-foreground-subtle">当前脚手架没有匹配模型</p>
          )}
        </div>
        <label className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3 text-ui-caption text-foreground-subtle">
          思考档位
          <Select
            value={selection.thinking || "default"}
            disabled={disabled || saving}
            onValueChange={(level) =>
              void save({ ...selection, thinking: level === "default" ? undefined : level }, false)
            }
          >
            <SelectTrigger aria-label={`${label}思考档位`} className="min-w-32" size="lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
              align="end"
              sideOffset={6}
              className="min-w-36"
            >
              {thinkingOptions(selection).map((level) => (
                <SelectItem key={level} value={level || "default"}>
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
