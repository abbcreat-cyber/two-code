import type { ActorRole, EngineSelection, HarnessId, HarnessInfo } from "@zcode/services";
const fieldClass =
  "h-8 w-full rounded-md border border-input-border bg-input px-2 text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-brand";
export function RoleCard({
  role,
  selection,
  catalog,
  disabled,
  harnessLocked,
  onChange,
}: {
  role: ActorRole;
  selection: EngineSelection;
  catalog: HarnessInfo[];
  disabled: boolean;
  harnessLocked?: boolean;
  onChange(value: EngineSelection): void;
}) {
  const label = role === "lead" ? "主手" : "副手";
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-ui-base font-medium">{label}</legend>
      <label className="grid gap-1 text-ui-caption text-foreground-subtle">
        脚手架
        <select
          className={fieldClass}
          aria-label={`${label}脚手架`}
          value={selection.harness}
          disabled={harnessLocked}
          onChange={(e) =>
            onChange({
              ...selection,
              harness: e.target.value as HarnessId,
              model: undefined,
              modelLabel: undefined,
              provider: undefined,
              thinking: undefined,
            })
          }
        >
          {catalog.map((h) => (
            <option key={h.id} value={h.id} disabled={!h.available}>
              {h.name}
              {h.available ? "" : "（未安装）"}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-ui-caption text-foreground-subtle">
        模型 ID
        <input
          className={fieldClass}
          aria-label={`${label}模型`}
          value={selection.model ?? ""}
          placeholder="留空沿用脚手架配置"
          onChange={(e) =>
            onChange({ ...selection, model: e.target.value || undefined, modelLabel: undefined })
          }
        />
      </label>
      <label className="grid gap-1 text-ui-caption text-foreground-subtle">
        显示名称
        <input
          className={fieldClass}
          aria-label={`${label}模型名称`}
          value={selection.modelLabel ?? ""}
          placeholder="例如：腾讯 DeepSeek"
          onChange={(e) => onChange({ ...selection, modelLabel: e.target.value || undefined })}
        />
      </label>
      {selection.harness !== "claude-code" && (
        <label className="grid gap-1 text-ui-caption text-foreground-subtle">
          提供方
          <input
            className={fieldClass}
            aria-label={`${label}提供方`}
            value={selection.provider ?? ""}
            placeholder="留空沿用当前配置"
            onChange={(e) => onChange({ ...selection, provider: e.target.value || undefined })}
          />
        </label>
      )}
      <label className="grid gap-1 text-ui-caption text-foreground-subtle">
        思考
        <select
          className={fieldClass}
          aria-label={`${label}思考`}
          value={selection.thinking ?? ""}
          onChange={(e) => onChange({ ...selection, thinking: e.target.value || undefined })}
        >
          <option value="">默认</option>
          {(selection.harness === "pi"
            ? ["off", "minimal", "low", "medium", "high", "xhigh"]
            : selection.harness === "zcode"
              ? ["disabled", "enabled", "low", "medium", "high", "xhigh", "max"]
              : ["low", "medium", "high", "xhigh", "max"]
          ).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
