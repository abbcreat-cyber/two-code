import type { ActorRole, EngineSelection, HarnessId, HarnessInfo } from "@zcode/services";
import { ArrowUpRight, Cpu, Layers2 } from "lucide-react";

interface Props {
  role: ActorRole;
  selection: EngineSelection;
  catalog: HarnessInfo[];
  disabled: boolean;
  actualModel?: string;
  sessionId?: string;
  onChange(value: EngineSelection): void;
}
export function RoleCard({
  role,
  selection,
  catalog,
  disabled,
  actualModel,
  sessionId,
  onChange,
}: Props) {
  const engine = catalog.find((item) => item.id === selection.harness);
  const listId = `two-code-models-${role}`;
  const thoughts =
    selection.harness === "pi"
      ? ["off", "minimal", "low", "medium", "high", "xhigh"]
      : selection.harness === "zcode"
        ? ["disabled", "enabled", "low", "medium", "high", "xhigh", "max"]
        : ["low", "medium", "high", "xhigh", "max"];
  return (
    <section
      className={`two-code-role two-code-role-${role}`}
      aria-label={role === "lead" ? "主手配置" : "副手配置"}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="two-code-role-mark">
            {role === "lead" ? <ArrowUpRight size={15} /> : <Layers2 size={15} />}
          </span>
          <span className="text-ui-base font-semibold">{role === "lead" ? "主手" : "副手"}</span>
          <span className="text-ui-xs text-foreground-subtle">
            {role === "lead" ? "判断 · 审查" : "执行 · 验证"}
          </span>
        </div>
        <Cpu size={14} className="text-foreground-subtlest" />
      </div>
      <div className="two-code-role-fields mt-3 grid gap-2">
        <label className="two-code-field">
          <span>脚手架</span>
          <select
            aria-label={`${role === "lead" ? "主手" : "副手"}脚手架`}
            disabled={disabled}
            value={selection.harness}
            onChange={(event) =>
              onChange({
                ...selection,
                harness: event.target.value as HarnessId,
                provider: undefined,
                thinking: undefined,
              })
            }
          >
            {catalog.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>
                {item.name}
                {item.available ? "" : " · 未安装"}
              </option>
            ))}
          </select>
        </label>
        <label className="two-code-field">
          <span>思考</span>
          <select
            aria-label={`${role === "lead" ? "主手" : "副手"}思考`}
            disabled={disabled}
            value={selection.thinking ?? ""}
            onChange={(event) =>
              onChange({ ...selection, thinking: event.target.value || undefined })
            }
          >
            <option value="">默认</option>
            {thoughts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="two-code-field col-span-2">
          <span>模型 ID{selection.modelLabel ? ` · ${selection.modelLabel}` : ""}</span>
          <input
            disabled={disabled}
            aria-label={`${role === "lead" ? "主手" : "副手"}模型`}
            list={listId}
            placeholder="留空沿用脚手架当前模型"
            value={selection.model ?? ""}
            onChange={(event) =>
              onChange({
                ...selection,
                model: event.target.value || undefined,
                modelLabel: undefined,
              })
            }
          />
          <datalist id={listId}>
            {engine?.models.map((model) => (
              <option key={`${model.provider}/${model.id}`} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        </label>
        {selection.harness !== "claude-code" && (
          <label className="two-code-field col-span-2">
            <span>提供方</span>
            <input
              disabled={disabled}
              aria-label={`${role === "lead" ? "主手" : "副手"}提供方`}
              placeholder="沿用当前配置"
              value={selection.provider ?? ""}
              onChange={(event) =>
                onChange({ ...selection, provider: event.target.value || undefined })
              }
            />
          </label>
        )}
      </div>
      <p className="mt-2 text-ui-xs text-foreground-subtlest" title={actualModel || engine?.detail}>
        {actualModel ? `会话模型 ID · ${actualModel}` : engine?.detail}
      </p>
      {sessionId && (
        <p
          className="mt-1 truncate font-mono text-ui-xs text-foreground-subtlest"
          title={sessionId}
        >
          会话 · {sessionId.slice(-24)}
        </p>
      )}
    </section>
  );
}
