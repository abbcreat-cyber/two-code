import { useEffect, useState } from "react";
import { GitBranch, ChevronDown } from "lucide-react";
import type { EngineSelection, HarnessInfo, TwoCodePreferences } from "@zcode/services";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { RoleCard } from "./RoleCard.js";

export function TwoCodeModelControls({
  value,
  catalog,
  locked,
  onChange,
  onNative,
}: {
  value: TwoCodePreferences;
  catalog: HarnessInfo[];
  locked: boolean;
  onChange(value: TwoCodePreferences): Promise<void>;
  onNative?: () => void;
}) {
  const [manage, setManage] = useState(false),
    [draft, setDraft] = useState(value),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!manage) setDraft(value);
  }, [value, manage]);
  const save = async (next: TwoCodePreferences) => {
    setSaving(true);
    setError("");
    try {
      await onChange(next);
      setManage(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  const select = (role: "lead" | "sidekick", selection: EngineSelection) => {
    const candidates = [...(catalog.find((h) => h.id === selection.harness)?.models ?? [])];
    if (
      selection.model &&
      !candidates.some(
        (m) => m.id === selection.model && (m.provider ?? "") === (selection.provider ?? ""),
      )
    )
      candidates.unshift({
        id: selection.model,
        name: selection.modelLabel ?? selection.model,
        provider: selection.provider,
      });
    return (
      <ModelConfigSelect
        normalizedValue={JSON.stringify([selection.provider ?? "", selection.model ?? ""])}
        modelGroups={[
          {
            key: role,
            label: catalog.find((h) => h.id === selection.harness)?.name ?? selection.harness,
            items: candidates.map((m) => ({
              key: `${m.provider}/${m.id}`,
              value: JSON.stringify([m.provider ?? "", m.id]),
              name: m.id === selection.model ? (selection.modelLabel ?? m.name) : m.name,
            })),
          },
        ]}
        triggerLabel={selection.modelLabel ?? selection.model ?? "管理模型"}
        triggerLabelPrefix={value.dual ? (role === "lead" ? "主手" : "副手") : undefined}
        triggerLabelValue={selection.modelLabel ?? selection.model ?? "管理模型"}
        triggerLabelPrefixClassName="mr-1 text-foreground-subtle"
        labelVisibilityClassName="inline-flex"
        triggerTestId={`two-code-${role}-model`}
        tooltipTitle={`${role === "lead" ? "主手" : "副手"} · ${selection.harness}`}
        disabled={saving || locked}
        showProviderLevel={false}
        showManageModelsAction
        manageModelsLabel="管理模型"
        focusSelectorOnClose='[data-testid="two-code-composer"]'
        lockReasonMessage="本任务保留当前组合"
        isItemLocked={() => false}
        onValueChange={(encoded) => {
          const [provider, model] = JSON.parse(encoded);
          void save({
            ...value,
            [role]: {
              ...selection,
              model,
              provider: provider || undefined,
              modelLabel: candidates.find((m) => m.id === model)?.name,
            },
          });
        }}
        onManageModels={() => {
          setDraft(value);
          setManage(true);
        }}
      />
    );
  };
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 px-2 text-ui-caption"
            data-testid="two-code-mode"
          >
            <GitBranch size={14} />
            {value.dual ? "双角色" : "单角色"}
            <ChevronDown size={12} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-64 p-2">
          <p className="px-2 py-1 text-ui-xs text-foreground-subtle">
            {value.lead.harness}
            {value.dual ? ` → ${value.sidekick.harness}` : ""}
          </p>
          <Button
            className="w-full justify-start"
            variant="ghost"
            disabled={locked || saving}
            onClick={() => void save({ ...value, dual: !value.dual })}
          >
            {value.dual ? "切换单角色" : "启用双角色"}
          </Button>
          <Button
            className="w-full justify-start"
            variant="ghost"
            onClick={() => {
              setDraft(value);
              setManage(true);
            }}
          >
            模型与脚手架
          </Button>
          {!locked && onNative && (
            <Button className="w-full justify-start" variant="ghost" onClick={onNative}>
              ZCode 原生模式
            </Button>
          )}
          {locked && (
            <p className="px-2 py-1 text-ui-xs text-foreground-subtle">切换组合请新建任务</p>
          )}
        </PopoverContent>
      </Popover>
      {select("lead", value.lead)}
      {value.dual && select("sidekick", value.sidekick)}
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="max-w-xl">
          <DialogTitle>模型与脚手架</DialogTitle>
          <DialogDescription>
            分别选择主手和副手。模型配置沿用本机脚手架，保存后用于新任务。
          </DialogDescription>
          <div className="grid gap-3 sm:grid-cols-2">
            <RoleCard
              role="lead"
              selection={draft.lead}
              catalog={catalog}
              disabled={locked || saving}
              onChange={(lead) => setDraft({ ...draft, lead })}
            />
            <RoleCard
              role="sidekick"
              selection={draft.sidekick}
              catalog={catalog}
              disabled={locked || saving}
              onChange={(sidekick) => setDraft({ ...draft, sidekick })}
            />
          </div>
          {error && (
            <p role="alert" className="text-ui-caption text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManage(false)}>
              关闭
            </Button>
            <Button disabled={locked || saving} onClick={() => void save(draft)}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
