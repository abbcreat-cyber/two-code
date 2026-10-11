import { useEffect, type MutableRefObject } from "react";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import {
  WORKSPACE_FILE_ADD_TO_CHAT_EVENT,
  isWorkspaceFileAddToChatEvent,
} from "@/lib/workspaceFileDrag.js";
import { appendWorkspaceFileMentionToComposer } from "@/lib/workspaceFileComposer.js";
import { shouldIgnoreEscapeForStopGeneration } from "@/v4/composer/escapeStop.js";

/** 复用原生文件引用与Esc规则；全局事件只交给当前可编辑窗格。 */
export function useTwoCodeComposerFeatures({
  enabled,
  busy,
  workspacePath,
  workspaceIdentity,
  inputApiRef,
  text,
  onChange,
  cancel,
}: {
  enabled: boolean;
  busy: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  inputApiRef: MutableRefObject<LexicalChatInputHandle | null>;
  text: string;
  onChange: (text: string) => void;
  cancel: () => Promise<void>;
}) {
  useEffect(() => {
    if (!enabled) return;
    const add = (event: Event) => {
      if (!isWorkspaceFileAddToChatEvent(event) || event.defaultPrevented) return;
      event.preventDefault();
      appendWorkspaceFileMentionToComposer({
        inputApiRef,
        currentMarkdown: inputApiRef.current?.getMarkdown() ?? text,
        payload: event.detail,
        workspacePath,
        workspaceIdentity,
        onTextChange: onChange,
      });
    };
    window.addEventListener(WORKSPACE_FILE_ADD_TO_CHAT_EVENT, add);
    return () => window.removeEventListener(WORKSPACE_FILE_ADD_TO_CHAT_EVENT, add);
  }, [enabled, inputApiRef, onChange, text, workspaceIdentity, workspacePath]);
  useEffect(() => {
    if (!enabled || !busy) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || shouldIgnoreEscapeForStopGeneration(event)) return;
      event.preventDefault();
      void cancel();
    };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [enabled, busy, cancel]);
}
