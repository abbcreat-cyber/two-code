import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square, ArrowUp } from "lucide-react";
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
import { useSettings } from "@/hooks/useSettingService.js";
import { useTwoCodeImages } from "@/hooks/useTwoCodeImages.js";

export function TwoCodeSessionPane(props: SessionPaneProps & { onNative?: () => void }) {
  const id = twoCodeTaskId(props.sessionId);
  const state = useTwoCode(props.workspacePath, id, (created, submittedText) => {
    const nextId = twoCodeSessionId(created);
    localStorage.setItem(
      `two-code:composer:${props.workspaceIdentity || props.workspacePath}:${nextId}`,
      submittedText,
    );
    // 创建回包只属于发送时的草稿；切走或改写正文后不能抢回页面、复制别处输入。
    if (draftKeyRef.current === draftKey && input.current?.getMarkdown() === submittedText)
      props.onSessionCreated?.(nextId);
  });
  const task = state.task,
    busy = task?.status === "running";
  const visibleError = state.error || (task?.status !== "cancelled" ? task?.error : undefined);
  const draftKey = `two-code:composer:${props.workspaceIdentity || props.workspacePath}:${props.sessionId ?? "draft"}`;
  const images = useTwoCodeImages(draftKey, state.importImage);
  const [sending, setSending] = useState(false),
    [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");
  const input = useRef<LexicalChatInputHandle | null>(null);
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
  const { settings } = useSettings();
  const showReasoning = settings?.messageStreamShowReasoning ?? true;
  const readAttachment = useCallback(
    async ({ ref, signal }: { ref: string; signal?: AbortSignal }) => {
      signal?.throwIfAborted();
      const image = await state.readImage(ref);
      signal?.throwIfAborted();
      return {
        bytes: Uint8Array.from(atob(image.dataBase64), (c) => c.charCodeAt(0)),
        mediaType: image.mime,
      };
    },
    [state.readImage],
  );
  const context = useMemo(
    () => ({
      workspacePath: props.workspacePath,
      workspaceIdentity: props.workspaceIdentity,
      theme,
      codePreviewSettings,
      sessionId: props.sessionId,
      readAttachment,
      messageStreamShowReasoning: showReasoning,
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
      showReasoning,
      readAttachment,
    ],
  );
  const send = (value: string) => {
    if (
      sending ||
      images.busy ||
      state.loading ||
      state.configuring ||
      (!value.trim() && !images.items.length)
    )
      return false;
    const sentImages = images.items;
    setSending(true);
    void state
      .submit(images.compose(value), value)
      .then((submittedId) => {
        if (!submittedId) return;
        images.clear(sentImages);
        const submittedKey = `two-code:composer:${props.workspaceIdentity || props.workspacePath}:${twoCodeSessionId(submittedId)}`;
        const keys = [draftKey, submittedKey];
        for (const key of keys)
          if (localStorage.getItem(key) === value) localStorage.removeItem(key);
        // 文本相同不等于同一草稿，必须同时核对来源/已创建任务身份。
        if (keys.includes(draftKeyRef.current) && input.current?.getMarkdown() === value) {
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
      {images.input}
      {permission && task && (
        <div data-testid="two-code-permission" data-tool={permission.title}>
          <PermissionDialog
            workspacePath={props.workspacePath}
            requesterLabel={permission.role === "lead" ? "主手" : "副手"}
            request={{
              type: "permission_request",
              taskId: props.sessionId!,
              traceId: task.id,
              requestId: permission.id,
              kind: "tool",
              title: `${permission.role === "lead" ? "主手" : "副手"} · ${permission.title}`,
              // 申请角色由卡片标题呈现，不能依靠会被原生工具说明覆盖的description。
              description: "",
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
      {visibleError && (
        <p role="alert" className="mb-2 max-h-28 overflow-auto text-ui-caption text-destructive">
          {visibleError}
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
          // 草稿由本组件恢复；禁止编辑器用首次空值在下一帧覆盖已恢复内容。
          syncInitialValueOnMount={false}
          placeholder={busy ? "补充要求…" : id ? "继续这个任务…" : "描述你的任务…"}
          inputTestId="two-code-composer"
          submitTestId="two-code-send"
          submitLabel="发送"
          topContent={images.chips}
          attachmentAction={{
            label: "添加图片",
            onSelect: images.open,
            testId: "two-code-add-image",
          }}
          onPaste={images.paste}
          enableExternalFileDrop
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={images.drop}
          allowSubmitWhenEmpty={images.items.length > 0}
          submitting={sending}
          submitDisabled={
            state.loading ||
            state.configuring ||
            sending ||
            images.busy ||
            (!text.trim() && !images.items.length)
          }
          enableMentionPanel={false}
          onChange={(value) => {
            setText(value);
            localStorage.setItem(draftKey, value);
          }}
          onSubmit={send}
          leadingActions={
            <TwoCodeModelControls
              key={`${props.workspaceIdentity || props.workspacePath}:${id ?? "draft"}`}
              value={selection}
              catalog={state.catalog}
              locked={busy || sending || state.loading || state.configuring || !!props.readOnly}
              onChange={state.savePreferences}
              onSaveDefaults={state.saveDefaults}
              hasSessions={{ lead: !!task?.lead.sessionId, sidekick: !!task?.sidekick.sessionId }}
              onNative={id ? undefined : props.onNative}
            />
          }
          submitControl={
            busy ? (
              <div className="flex items-center gap-1">
                {(text.trim() || images.items.length > 0) && (
                  <Button
                    aria-label="发送补充"
                    title="发送补充"
                    data-testid="two-code-send"
                    size="icon-sm"
                    disabled={sending || images.busy || state.loading || state.configuring}
                    onClick={() => send(input.current?.getMarkdown() ?? text)}
                  >
                    <ArrowUp size={14} />
                  </Button>
                )}
                <Button
                  aria-label="停止"
                  data-testid="two-code-stop"
                  size="icon-sm"
                  onClick={() => void state.cancel()}
                >
                  <Square size={14} />
                </Button>
              </div>
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
            ? permission
              ? `待确认 · ${permission.role === "lead" ? "主手" : "副手"}`
              : "执行中"
            : task.status === "cancelled"
              ? "已停止"
              : task.status === "error"
                ? "需要处理"
                : task.status === "idle"
                  ? "未开始"
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
