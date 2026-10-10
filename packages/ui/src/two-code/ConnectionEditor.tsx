import { useEffect, useState } from "react";
import { Plus, Trash2, Save, KeyRound } from "lucide-react";
import type { HarnessConnection, ModelSettingsView, SaveHarnessConnection } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
export function ConnectionEditor({
  connection,
  revision,
  isNew,
  onSave,
  onRemove,
}: {
  connection: HarnessConnection;
  revision: string;
  isNew?: boolean;
  onSave(input: SaveHarnessConnection): Promise<ModelSettingsView>;
  onRemove(id: string, revision: string): Promise<ModelSettingsView>;
}) {
  const [draft, setDraft] = useState(connection),
    [base, setBase] = useState(revision),
    [key, setKey] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setDraft(connection);
      setBase(revision);
    }
  }, [connection, revision, dirty]);
  const update = (next: Partial<HarnessConnection>) => {
    setDraft((old) => ({ ...old, ...next }));
    setDirty(true);
    setNotice("");
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({ revision: base, connection: draft, ...(key ? { apiKey: key } : {}) });
      setKey("");
      setDirty(false);
      setNotice("已保存，下一轮任务生效");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-6" data-testid="two-code-connection-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-ui-lg font-semibold">{isNew ? "新增连接" : connection.name}</h3>
          <p className="mt-1 text-ui-caption text-foreground-subtle">
            {connection.source === "native" && !isNew
              ? "已读取本机配置，保存的更改仅用于 Two Code"
              : "此连接由 Two Code 管理"}
          </p>
        </div>
        <Button size="sm" disabled={saving || (!dirty && !isNew)} onClick={() => void save()}>
          <Save className="size-4" />
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-ui-caption text-foreground-subtle">
          连接名称
          <Input
            aria-label="连接名称"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <label className="space-y-2 text-ui-caption text-foreground-subtle">
          接口格式
          <Select
            value={draft.api}
            disabled={draft.harness === "claude-code" || saving}
            onValueChange={(api) => update({ api: api as HarnessConnection["api"] })}
          >
            <SelectTrigger aria-label="接口格式" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
              <SelectItem value="openai-completions">OpenAI Chat Completions</SelectItem>
              <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-2 text-ui-caption text-foreground-subtle sm:col-span-2">
          API 地址
          <Input
            aria-label="API 地址"
            placeholder="https://…"
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </label>
        <label className="space-y-2 text-ui-caption text-foreground-subtle sm:col-span-2">
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-3.5" />
            API 密钥{connection.hasApiKey && <span className="text-ui-xs">· 已保存</span>}
          </span>
          <Input
            type="password"
            aria-label="API 密钥"
            autoComplete="new-password"
            value={key}
            placeholder={
              connection.hasApiKey ? "留空保留已保存的密钥" : "使用本机登录或无密钥服务时可留空"
            }
            onChange={(e) => {
              setKey(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </fieldset>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-ui-base font-medium">
            模型 <span className="ml-1 text-foreground-subtle">{draft.models.length}</span>
          </h4>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              update({ models: [...draft.models, { id: "", name: "", reasoning: true }] })
            }
          >
            <Plus className="size-3.5" />
            添加模型
          </Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-ui-caption">
            <thead className="bg-surface text-foreground-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">模型 ID</th>
                <th className="px-3 py-2 font-medium">模型名称</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">名称来源</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {draft.models.map((m, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="min-w-40 p-2">
                    <Input
                      aria-label={`模型 ID ${index + 1}`}
                      value={m.id}
                      disabled={saving}
                      onChange={(e) =>
                        update({
                          models: draft.models.map((item, i) =>
                            i === index
                              ? { ...item, id: e.target.value, realModel: undefined }
                              : item,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="min-w-40 p-2">
                    <Input
                      aria-label={`模型名称 ${index + 1}`}
                      value={m.name}
                      disabled={saving}
                      onChange={(e) =>
                        update({
                          models: draft.models.map((item, i) =>
                            i === index ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 text-ui-xs text-foreground-subtle">
                    {m.realModel ? "上游已核验" : "配置名称"}
                  </td>
                  <td className="p-2">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`移除模型 ${index + 1}`}
                      disabled={saving || draft.models.length <= 1}
                      onClick={() => update({ models: draft.models.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-ui-xs text-foreground-subtlest">
          模型 ID 用于请求；未提供上游名称的服务使用这里填写的名称。
        </p>
      </section>
      {error && (
        <p role="alert" className="text-ui-caption text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-ui-caption text-foreground-subtle">
          {notice}
        </p>
      )}
      {dirty && revision !== base && (
        <p role="alert" className="text-ui-caption text-warning">
          设置已在其他窗口更新。当前输入已保留，保存时会检查冲突。
        </p>
      )}
      {!isNew && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size="sm"
            disabled={saving}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setSaving(true);
              try {
                await onRemove(connection.id, base);
              } catch (cause) {
                setError(String(cause));
                setSaving(false);
              }
            }}
          >
            <Trash2 className="size-3.5" />
            {confirmDelete ? "确认移除此连接" : "移除连接"}
          </Button>
          <span className="text-ui-xs text-foreground-subtlest">仅从 Two Code 移除</span>
        </div>
      )}
    </div>
  );
}
