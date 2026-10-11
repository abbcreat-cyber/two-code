import type { Event } from "@zcode/rpc";
import type { TwoCodeModelSettingsApi } from "./settings-contract.js";
import type { TwoCodeImagesApi } from "./image-contract.js";
export { twoCodeForkPoints } from "./domain/fork-points.js";
export {
  modelThinkingProfiles,
  selectionThinkingProfile,
  normalizeThinkingSelection,
} from "./domain/thinking.js";
export type {
  ConnectionModel,
  HarnessConnection,
  ModelSettingsView,
  SaveHarnessConnection,
} from "./settings-contract.js";

export type HarnessId = "zcode" | "claude-code" | "pi" | "step-code";
export type ActorRole = "lead" | "sidekick";
export type TwoCodeMode = "plan" | "build" | "edit" | "yolo";
export interface RunUsage {
  id: string;
  role: ActorRole;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  steps: number;
  modelMs: number | null;
  toolMs: number | null;
  ttftMs: number | null;
}
export function twoCodeSessionId(id: string): string {
  return `two-code:${id}`;
}
export function twoCodeTaskId(sessionId: string | null | undefined): string | null {
  return sessionId?.startsWith("two-code:") ? sessionId.slice("two-code:".length) : null;
}
export type TaskStatus = "idle" | "running" | "completed" | "cancelled" | "error";
export interface EngineSelection {
  harness: HarnessId;
  provider?: string;
  model?: string;
  modelLabel?: string;
  thinking?: string;
}
export interface HarnessInfo {
  id: HarnessId;
  name: string;
  available: boolean;
  detail: string;
  defaultModel?: string;
  defaultProvider?: string;
  models: Array<{
    id: string;
    provider?: string;
    name: string;
    aliases?: string[];
    realModel?: string;
  }>;
}
export interface TaskEvent {
  blockId?: string;
  requestId?: string;
  deliveryFailed?: boolean;
  handoffUserSeq?: number;
  continuation?: boolean;
  toolCallId?: string;
  notExecuted?: boolean;
  seq: number;
  at: string;
  role: ActorRole | "user" | "system";
  kind:
    | "message"
    | "reasoning"
    | "tool"
    | "tool_input"
    | "tool_end"
    | "verification"
    | "status"
    | "error"
    | "handoff"
    | "handoff_update"
    | "handoff_report";
  text: string;
}
export interface ActorState {
  availableTools?: string[];
  selection: EngineSelection;
  sessionId?: string;
  actualModel?: string;
  status: TaskStatus;
  lastReport?: string;
}
export interface PermissionRequest {
  id: string;
  role: ActorRole;
  title: string;
  detail: string;
}
export interface TwoCodeTask {
  forkSource?: { taskId: string; atSeq: number; requestId: string };
  mode?: TwoCodeMode;
  usage?: RunUsage[];
  id: string;
  workspacePath: string;
  title: string;
  dual: boolean;
  status: TaskStatus;
  lead: ActorState;
  sidekick: ActorState;
  events: TaskEvent[];
  permissions: PermissionRequest[];
  requestIds: string[];
  updatedAt: string;
  error?: string;
}
export interface CreateTwoCodeTask {
  mode?: TwoCodeMode;
  workspacePath: string;
  title?: string;
  dual: boolean;
  lead: EngineSelection;
  sidekick: EngineSelection;
}
export type TwoCodePreferences = Pick<CreateTwoCodeTask, "dual" | "lead" | "sidekick" | "mode">;
export interface ITwoCodeService extends TwoCodeModelSettingsApi, TwoCodeImagesApi {
  catalog(): Promise<HarnessInfo[]>;
  list(workspacePath: string): Promise<TwoCodeTask[]>;
  create(input: CreateTwoCodeTask): Promise<TwoCodeTask>;
  read(taskId: string): Promise<TwoCodeTask>;
  fork(input: { taskId: string; atSeq: number; requestId: string }): Promise<TwoCodeTask>;
  configure(input: { taskId: string; preferences: TwoCodePreferences }): Promise<TwoCodeTask>;
  submit(input: { taskId: string; requestId: string; text: string }): Promise<TwoCodeTask>;
  cancel(taskId: string): Promise<TwoCodeTask>;
  respond(input: { taskId: string; permissionId: string; allow: boolean }): Promise<void>;
  preferences(): Promise<TwoCodePreferences>;
  configurePreferences(input: TwoCodePreferences): Promise<TwoCodePreferences>;
  onDidChange: Event<TwoCodeTask>;
  dispose(): Promise<void>;
}
export type ITwoCodeExecutionService = Omit<
  ITwoCodeService,
  | "modelSettings"
  | "saveConnection"
  | "removeConnection"
  | "testConnection"
  | "onDidCatalogChange"
  | "importImage"
  | "readImage"
>;
export const ITwoCodeService: { readonly channelName: string; readonly _brand?: ITwoCodeService } =
  { channelName: "two-code" };
