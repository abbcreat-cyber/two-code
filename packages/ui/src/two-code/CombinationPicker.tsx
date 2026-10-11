import { useId, useState } from "react";
import {
  Check,
  Plus,
  MoreHorizontal,
  Pencil,
  Star,
  RefreshCw,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import type {
  ActorRole,
  HarnessInfo,
  TwoCodeCombination,
  TwoCodePreferences,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import { useTwoCodeCombinations } from "@/hooks/useTwoCodeCombinations.js";
import { selectedModelName, sameModel, thinkingLabels } from "./modelChoices.js";

function matches(a: TwoCodePreferences, b: TwoCodePreferences) {
  return (
    a.dual === b.dual &&
    (a.mode ?? "build") === (b.mode ?? "build") &&
    (a.dual ? (["lead", "sidekick"] as const) : (["lead"] as const)).every(
      (role) =>
        sameModel(a[role], b[role]) && (a[role].thinking ?? "") === (b[role].thinking ?? ""),
    )
  );
}
function Summary({ value, catalog }: { value: TwoCodePreferences; catalog: HarnessInfo[] }) {
  const name = (role: ActorRole) =>
    `${selectedModelName(catalog, value[role])}${value[role].thinking ? ` · ${thinkingLabels[value[role].thinking!] ?? value[role].thinking}` : ""}`;
  return (
    <span className="flex min-w-0 items-center gap-2 text-ui-xs text-foreground-subtle">
      <span className="min-w-0 flex-1 truncate" title={name("lead")}>
        <span className="mr-1 text-foreground-subtlest">主</span>
        {name("lead")}
      </span>
      {
        <>
          <span aria-hidden="true" className="text-foreground-subtlest">
            /
          </span>
          <span className="min-w-0 flex-1 truncate" title={value.dual ? name("sidekick") : "无"}>
            <span className="mr-1 text-foreground-subtlest">副</span>
            {value.dual ? name("sidekick") : "无"}
          </span>
        </>
      }
    </span>
  );
}
export function CombinationPicker({
  workspacePath,
  value,
  catalog,
  locked,
  hasSessions,
  onApply,
}: {
  workspacePath: string;
  value: TwoCodePreferences;
  catalog: HarnessInfo[];
  locked: boolean;
  hasSessions: Partial<Record<ActorRole, boolean>>;
  onApply(value: TwoCodePreferences): Promise<void>;
}) {
  const library = useTwoCodeCombinations(workspacePath);
  const nameId = useId();
  const [editing, setEditing] = useState<{
      kind: "save" | "rename" | "replace" | "delete";
      item?: TwoCodeCombination;
    }>(),
    [name, setName] = useState(""),
    [newName, setNewName] = useState(""),
    [notice, setNotice] = useState(""),
    [localError, setLocalError] = useState(""),
    [preferred, setPreferred] = useState<string>();
  const disabled = locked || library.busy;
  const items = library.view?.items ?? [];
  const active = (
    items.find((c) => c.id === preferred && matches(c.preferences, value)) ??
    items.find((c) => matches(c.preferences, value))
  )?.id;
  const begin = (kind: NonNullable<typeof editing>["kind"], item?: TwoCodeCombination) => {
    setName(item?.name ?? newName);
    setLocalError("");
    setNotice("");
    setEditing({ kind, item });
  };
  const action = async (fn: () => Promise<unknown>, message?: string) => {
    setLocalError("");
    try {
      await fn();
      if (message) setNotice(message);
      setEditing(undefined);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };
  const submit = () => {
    if (!editing || disabled) return;
    const { kind, item } = editing;
    void action(
      async () => {
        const result =
          kind === "delete"
            ? await library.remove(item!.id)
            : await library.save({
                id: item?.id,
                name: kind === "replace" ? item!.name : name,
                ...(kind === "save" || kind === "replace" ? { preferences: value } : {}),
              });
        if (kind === "save") setNewName("");
        return result;
      },
      kind === "delete" ? "组合已删除" : "组合已保存",
    );
  };
  return (
    <div data-testid="two-code-combinations" className="min-w-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          {editing && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="返回组合列表"
              onClick={() => setEditing(undefined)}
              disabled={library.busy}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
          )}
          <h3 className="text-ui-base font-semibold text-foreground">
            {editing
              ? { save: "保存当前组合", rename: "重命名", replace: "更新组合", delete: "删除组合" }[
                  editing.kind
                ]
              : "AI 组合"}
          </h3>
          {!editing && library.view && (
            <span
              className="text-ui-xs tabular-nums text-foreground-subtlest"
              data-testid="two-code-combination-count"
            >
              {items.length}/10
            </span>
          )}
        </div>
        {!editing && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="保存当前配置为新组合"
            title="保存当前配置为新组合"
            data-testid="two-code-combination-add"
            disabled={disabled || !library.view}
            onClick={() => begin("save")}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="space-y-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            // 弹层通过Portal仍沿React树冒泡；保存组合不能触发外层聊天表单发送草稿。
            e.stopPropagation();
            submit();
          }}
        >
          {editing.kind === "delete" ? (
            <p className="text-ui-caption text-foreground-subtle">
              删除「{editing.item?.name}」？
              {editing.item?.id === library.view?.defaultId
                ? `新任务将默认使用「${items.find((c) => c.id !== editing.item?.id)?.name}」。`
                : "已创建的任务不会改变。"}
            </p>
          ) : (
            <>
              {(editing.kind === "save" || editing.kind === "rename") && (
                <div className="space-y-1.5">
                  <label htmlFor={nameId} className="text-ui-xs text-foreground-subtle">
                    组合名称
                  </label>
                  <Input
                    id={nameId}
                    data-testid="two-code-combination-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (editing.kind === "save") setNewName(e.target.value);
                    }}
                    maxLength={40}
                    placeholder="例如：日常协作"
                    autoComplete="off"
                    disabled={library.busy}
                  />
                </div>
              )}
              <div className="rounded-lg bg-surface px-3 py-2.5">
                <Summary
                  value={editing.kind === "rename" ? editing.item!.preferences : value}
                  catalog={catalog}
                />
              </div>
              {editing.kind === "replace" && (
                <p className="text-ui-xs text-foreground-subtle">
                  用当前配置更新「{editing.item?.name}」。
                  {editing.item?.id === library.view?.defaultId ? "新任务的默认配置也会更新。" : ""}
                </p>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={library.busy}
              onClick={() => setEditing(undefined)}
            >
              取消
            </Button>
            <Button
              size="sm"
              type="submit"
              variant={editing.kind === "delete" ? "destructive" : "secondary"}
              data-testid="two-code-combination-confirm"
              disabled={
                disabled || ((editing.kind === "save" || editing.kind === "rename") && !name.trim())
              }
            >
              {library.busy
                ? "保存中…"
                : editing.kind === "delete"
                  ? "删除"
                  : editing.kind === "replace"
                    ? "更新"
                    : "保存"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto px-2 pb-3">
          {!library.view && (
            <p className="px-2 py-3 text-ui-caption text-foreground-subtle">正在加载组合…</p>
          )}
          {items.map((item) => {
            const conflict = (["lead", "sidekick"] as const).some(
              (role) =>
                hasSessions[role] &&
                (role !== "sidekick" || item.preferences.dual) &&
                value[role].harness !== item.preferences[role].harness,
            );
            return (
              <div
                key={item.id}
                data-testid="two-code-combination-row"
                data-combination-id={item.id}
                className={`group flex items-center gap-1 rounded-xl p-1 ${active === item.id ? "bg-selected" : "hover:bg-hover"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`two-code-combination-use-${item.id}`}
                  aria-pressed={active === item.id}
                  disabled={disabled || conflict}
                  title={conflict ? "已有会话不能跨底座切换，请在新任务中使用此组合" : undefined}
                  onClick={() =>
                    void action(async () => {
                      await onApply(item.preferences);
                      setPreferred(item.id);
                    })
                  }
                >
                  <span className="flex w-4 shrink-0 justify-center pt-1">
                    {active === item.id ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="mt-1 size-1 rounded-full bg-foreground-subtlest/50" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-ui-base font-medium">{item.name}</span>
                      {item.id === library.view?.defaultId && (
                        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                          默认
                        </span>
                      )}
                    </span>
                    <Summary value={item.preferences} catalog={catalog} />
                    {conflict && (
                      <span className="block text-ui-xs text-foreground-subtlest">
                        需在新任务中使用
                      </span>
                    )}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="mr-1 shrink-0 text-foreground-subtle"
                      aria-label={`管理${item.name}`}
                      disabled={disabled}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => begin("rename", item)}>
                      <Pencil className="size-3.5" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => begin("replace", item)}>
                      <RefreshCw className="size-3.5" />
                      用当前配置更新
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={item.id === library.view?.defaultId}
                      onSelect={() =>
                        void action(
                          () => library.makeDefault(item.id),
                          `「${item.name}」已设为新任务默认`,
                        )
                      }
                    >
                      <Star className="size-3.5" />
                      设为默认
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={items.length < 2}
                      onSelect={() => begin("delete", item)}
                    >
                      <Trash2 className="size-3.5" />
                      删除组合
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}
      {(localError || library.error) && (
        <p role="alert" className="px-4 pb-3 text-ui-caption text-destructive">
          {localError || library.error}
        </p>
      )}
      {notice && !localError && !library.error && (
        <p role="status" className="px-4 pb-3 text-ui-xs text-foreground-subtle">
          {notice}
        </p>
      )}
    </div>
  );
}
