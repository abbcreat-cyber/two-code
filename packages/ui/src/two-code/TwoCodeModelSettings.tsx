import { useEffect, useState, type ReactNode } from "react";
import { Code2, Terminal, Workflow, Plus, RefreshCw, Cable } from "lucide-react";
import type { HarnessConnection, HarnessId } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useTwoCodeModelSettings } from "@/hooks/useTwoCodeModelSettings.js";
import { consumeHarnessSettings, harnessSettingsEvent } from "./settingsNavigation.js";
import { ConnectionEditor } from "./ConnectionEditor.js";
export function TwoCodeModelSettings({
  children,
  nativeTarget,
}: {
  children: ReactNode;
  nativeTarget?: boolean;
}) {
  const state = useTwoCodeModelSettings();
  useEffect(() => {
    if (nativeTarget) {
      setHarness("zcode");
      setCreating(undefined);
    }
  }, [nativeTarget]);
  const [harness, setHarness] = useState<HarnessId>(
      () =>
        consumeHarnessSettings() ??
        (sessionStorage.getItem("two-code:settings-harness") === "pi"
          ? "pi"
          : sessionStorage.getItem("two-code:settings-harness") === "claude-code"
            ? "claude-code"
            : "zcode"),
    ),
    [selected, setSelected] = useState<string>(),
    [creating, setCreating] = useState<HarnessConnection>();
  useEffect(() => {
    sessionStorage.setItem("two-code:settings-harness", harness);
  }, [harness]);
  useEffect(() => {
    const listener = () => {
      const next = consumeHarnessSettings();
      if (next) {
        setHarness(next);
        setSelected(undefined);
        setCreating(undefined);
      }
    };
    window.addEventListener(harnessSettingsEvent, listener);
    return () => window.removeEventListener(harnessSettingsEvent, listener);
  }, []);
  const connections = state.view?.connections.filter((c) => c.harness === harness) ?? [];
  const current = creating ?? connections.find((c) => c.id === selected) ?? connections[0];
  if (!state.available) return children;
  const engines = [
    { id: "zcode", name: "ZCode", icon: Code2, description: "原生供应商与模型" },
    { id: "claude-code", name: "Claude Code", icon: Terminal, description: "连接与模型配置" },
    { id: "pi", name: "Pi", icon: Workflow, description: "连接与模型配置" },
  ] as const;
  return (
    <div className="space-y-5" data-testid="two-code-model-settings">
      <p className="text-ui-base text-foreground-subtle">选择脚手架，统一管理连接与模型。</p>
      <div className="grid grid-cols-3 gap-3" role="tablist" aria-label="脚手架设置">
        {engines.map((engine) => (
          <button
            key={engine.id}
            role="tab"
            aria-selected={harness === engine.id}
            data-testid={`two-code-settings-${engine.id}`}
            className={`min-w-0 rounded-xl border p-4 text-left transition-colors ${harness === engine.id ? "border-primary/60 bg-selected" : "border-border bg-card hover:bg-surface-hover"}`}
            onClick={() => {
              setHarness(engine.id);
              setSelected(undefined);
              setCreating(undefined);
            }}
          >
            <span className="flex items-center gap-2 text-ui-base font-medium">
              <engine.icon className="size-4 shrink-0" />
              {engine.name}
            </span>
            <span className="mt-1.5 block text-ui-xs text-foreground-subtle">
              {state.catalog.find((h) => h.id === engine.id)?.available === false
                ? "尚未安装脚手架"
                : engine.description}
            </span>
          </button>
        ))}
      </div>
      {harness === "zcode" ? (
        children
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-ui-base font-medium">连接与模型</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="刷新模型连接"
                onClick={() => void state.refresh()}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const id = crypto.randomUUID();
                  setCreating({
                    id,
                    harness,
                    provider: `two-code-${id.slice(0, 8)}`,
                    name: "新连接",
                    baseUrl: "",
                    api: harness === "claude-code" ? "anthropic-messages" : "openai-completions",
                    hasApiKey: false,
                    source: "two-code",
                    models: [{ id: "", name: "", reasoning: true }],
                  });
                }}
              >
                <Plus className="size-4" />
                新增连接
              </Button>
            </div>
          </div>
          {state.error && (
            <p role="alert" className="text-ui-caption text-destructive">
              {state.error}
            </p>
          )}
          <div className="grid min-h-96 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[210px_minmax(0,1fr)]">
            <nav
              aria-label="模型连接"
              className="space-y-1 border-b border-border bg-surface/40 p-2 md:border-b-0 md:border-r"
            >
              {connections.map((c) => (
                <button
                  key={c.id}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left ${current?.id === c.id ? "bg-selected" : "hover:bg-surface-hover"}`}
                  onClick={() => {
                    setSelected(c.id);
                    setCreating(undefined);
                  }}
                >
                  <Cable className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <span className="min-w-0">
                    <span className="block break-words text-ui-base">{c.name}</span>
                    <span className="mt-1 block text-ui-xs text-foreground-subtle">
                      {c.models.length} 个模型 · {c.source === "native" ? "本机配置" : "Two Code"}
                    </span>
                  </span>
                </button>
              ))}
              {!connections.length && (
                <p className="p-3 text-ui-caption text-foreground-subtle">暂无连接</p>
              )}
            </nav>
            <div className="min-w-0 p-5">
              {current && state.view ? (
                <ConnectionEditor
                  key={current.id}
                  connection={current}
                  revision={state.view.revision}
                  isNew={!!creating}
                  onSave={async (input) => {
                    const view = await state.save(input);
                    setCreating(undefined);
                    setSelected(input.connection.id);
                    return view;
                  }}
                  onRemove={async (id, revision) => {
                    const view = await state.remove(id, revision);
                    setSelected(undefined);
                    return view;
                  }}
                />
              ) : (
                <div className="flex min-h-72 items-center justify-center text-ui-base text-foreground-subtle">
                  {state.view ? "添加一个连接，开始配置模型" : "正在读取本机配置…"}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
