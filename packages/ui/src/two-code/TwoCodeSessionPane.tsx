import { useEffect, useMemo, useRef, useState } from "react";
import { Square } from "lucide-react";
import { twoCodeSessionId, twoCodeTaskId } from "@zcode/services";
import { useTwoCode } from "@/hooks/useTwoCode.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import { ConversationHeader } from "@/v4/ConversationHeader.js";
import { ConversationDraftEmptyState } from "@/v4/ConversationDraftEmptyState.js";
import { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { Button } from "@/components/ui/button.js";
import { PermissionDialog } from "@/PermissionDialog.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import type { SessionPaneProps } from "@/v4/SessionPane.js";
import { projectTwoCodeRows } from "./conversationProjection.js";
import { TwoCodeModelControls } from "./TwoCodeModelControls.js";
import { SessionStatisticsBar } from "@/v4/composer/SessionStatisticsBar.js";
import { projectTwoCodeUsage } from "./usageProjection.js";

export function TwoCodeSessionPane(props: SessionPaneProps & { onNative?: () => void }) {
  const id = twoCodeTaskId(props.sessionId);
  const state = useTwoCode(props.workspacePath, id, (created) => {
    const nextId = twoCodeSessionId(created);
    localStorage.setItem(
      `two-code:composer:${props.workspaceIdentity || props.workspacePath}:${nextId}`,
      input.current?.getMarkdown() ?? "",
    );
    props.onSessionCreated?.(nextId);
  });
  const task = state.task,
    busy = task?.status === "running";
  const [sending, setSending] = useState(false),
    [text, setText] = useState("");
  const input = useRef<LexicalChatInputHandle | null>(null);
  const draftKey = `two-code:composer:${props.workspaceIdentity || props.workspacePath}:${props.sessionId ?? "draft"}`;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  useEffect(() => {
    const saved = localStorage.getItem(draftKey) ?? "";
    setText(saved);
    input.current?.setText(saved);
  }, [draftKey]);
  const theme = useZCodeStoreWithDefault((s) => s.theme, "system");
  const codePreviewSettings = useZCodeStoreWithDefault(
    (s) => s.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const rows = useMemo(() => projectTwoCodeRows(task), [task]);
  const context = useMemo(
    () => ({
      workspacePath: props.workspacePath,
      workspaceIdentity: props.workspaceIdentity,
      theme,
      codePreviewSettings,
      sessionId: props.sessionId,
      onOpenFileLink: props.onOpenFileLink,
      onOpenBrowserUrl: props.onOpenBrowserUrl,
      onOpenCodeViewer: props.onOpenCodeViewer,
      chatLoadingBlockedByInteraction: !!task?.permissions.length,
    }),
    [
      props.workspacePath,
      props.workspaceIdentity,
      props.sessionId,
      props.onOpenFileLink,
      props.onOpenBrowserUrl,
      props.onOpenCodeViewer,
      theme,
      codePreviewSettings,
      task?.permissions.length,
    ],
  );
  const send = (value: string) => {
    if (busy || sending || state.loading || state.configuring || !value.trim()) return false;
    setSending(true);
    void state
      .submit(value)
      .then(() => {
        if (localStorage.getItem(draftKey) === value) localStorage.removeItem(draftKey);
        if (input.current?.getMarkdown() === value) {
          localStorage.removeItem(draftKeyRef.current);
          setText("");
          input.current.setText("");
        }
      })
      .catch(() => {})
      .finally(() => setSending(false));
    return false;
  };
  const selection = task
    ? {
        dual: task.dual,
        lead: task.lead.selection,
        sidekick: task.sidekick.selection,
        mode: task.mode,
      }
    : state.preferences;
  const permission = task?.permissions[0];
  const dock = (
    // 原生Timeline已经限定底部输入列宽度；这里不能再次缩窄，否则与消息列错位。
    <div className="chat-composer-region z-20 w-full shrink-0 @container/composer">
      {permission && task && (
        <div data-testid="two-code-permission" data-tool={permission.title}>
          <PermissionDialog
            workspacePath={props.workspacePath}
            request={{
              type: "permission_request",
              taskId: props.sessionId!,
              traceId: task.id,
              requestId: permission.id,
              kind: "tool",
              title: `${permission.role === "lead" ? "主手" : "副手"} · ${permission.title}`,
              description: permission.detail,
              raw: { toolName: permission.title, input: safeJson(permission.detail) },
              options: [
                {
                  optionId: "allow",
                  kind: "allow_once",
                  name: "允许本次",
                  response: { decision: "allow" },
                },
                {
                  optionId: "deny",
                  kind: "reject_once",
                  name: "拒绝",
                  response: { decision: "deny" },
                },
              ],
            }}
            onRespond={(permissionId, option) =>
              void state.respond(permissionId, option.optionId === "allow")
            }
          />
        </div>
      )}
      {(state.error || task?.error) && (
        <p role="alert" className="mb-2 max-h-28 overflow-auto text-ui-caption text-destructive">
          {state.error || task?.error}
        </p>
      )}
      {!id && props.draftComposerHeader}
      {!props.readOnly && (
        <ChatPromptEditor
          workspacePath={props.workspacePath}
          workspaceIdentity={props.workspaceIdentity}
          taskId={null}
          inputApiRef={input}
          initialValue={text}
          placeholder={id ? "继续这个任务…" : "描述你的任务…"}
          inputTestId="two-code-composer"
          submitTestId="two-code-send"
          submitLabel="发送"
          submitting={sending}
          submitDisabled={busy || state.loading || state.configuring || sending || !text.trim()}
          enableMentionPanel={false}
          onChange={(value) => {
            setText(value);
            localStorage.setItem(draftKey, value);
          }}
          onSubmit={send}
          leadingActions={
            <TwoCodeModelControls
              value={selection}
              catalog={state.catalog}
              locked={busy || sending || state.loading || state.configuring || !!props.readOnly}
              onChange={state.savePreferences}
              onNative={id ? undefined : props.onNative}
            />
          }
          submitControl={
            busy ? (
              <Button
                aria-label="停止"
                data-testid="two-code-stop"
                size="icon-sm"
                onClick={() => void state.cancel()}
              >
                <Square size={14} />
              </Button>
            ) : undefined
          }
        />
      )}
      <SessionStatisticsBar usage={projectTwoCodeUsage(task)} />
      {task && (
        <div
          className="mt-2 flex justify-end gap-2 text-ui-xs text-foreground-subtlest"
          data-testid="two-code-state"
          data-status={task.status}
        >
          {busy
            ? "执行中"
            : task.status === "cancelled"
              ? "已停止"
              : task.status === "error"
                ? "需要处理"
                : "已结束"}
        </div>
      )}
    </div>
  );
  return (
    <section
      className="relative flex h-full min-h-0 flex-1 flex-col"
      data-testid="two-code-native-session"
    >
      <ConversationHeader
        title={task?.title ?? "新任务"}
        onClosePane={props.onClosePane}
        workspaceBadge={props.workspaceBadge}
      />
      <div className="@container/conversation flex min-h-0 flex-1 flex-col">
        <ConversationTimeline
          rows={rows}
          totalCount={rows.length}
          sessionKey={props.sessionId ?? "draft"}
          rowContext={context}
          bottomDock={dock}
          emptyState={
            !id ? (
              <ConversationDraftEmptyState />
            ) : state.loading ? (
              <p className="text-ui-base">加载中…</p>
            ) : undefined
          }
          centerEmptyStateWithDock={!id}
          summaryPanelLayout="none"
          conversationFindQuery={props.conversationFindQuery}
          conversationFindActiveIndex={props.conversationFindActiveIndex}
          conversationFindNavigationRequestId={props.conversationFindNavigationRequestId}
          onConversationFindMatchStateChange={props.onConversationFindMatchStateChange}
        />
      </div>
    </section>
  );
}
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { description: text };
  }
}
