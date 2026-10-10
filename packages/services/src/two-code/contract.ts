import type { Event } from "@zcode/rpc";

export type HarnessId = "zcode" | "claude-code" | "pi";
export type ActorRole = "lead" | "sidekick";
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
  models: Array<{ id: string; provider?: string; name: string }>;
}
export interface TaskEvent {
  seq: number;
  at: string;
  role: ActorRole | "user" | "system";
  kind: "message" | "tool" | "status" | "error" | "handoff";
  text: string;
}
export interface ActorState {
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
  workspacePath: string;
  title?: string;
  dual: boolean;
  lead: EngineSelection;
  sidekick: EngineSelection;
}
export type TwoCodePreferences = Pick<CreateTwoCodeTask, "dual" | "lead" | "sidekick">;
export interface ITwoCodeService {
  catalog(): Promise<HarnessInfo[]>;
  list(workspacePath: string): Promise<TwoCodeTask[]>;
  create(input: CreateTwoCodeTask): Promise<TwoCodeTask>;
  read(taskId: string): Promise<TwoCodeTask>;
  submit(input: { taskId: string; requestId: string; text: string }): Promise<TwoCodeTask>;
  cancel(taskId: string): Promise<TwoCodeTask>;
  respond(input: { taskId: string; permissionId: string; allow: boolean }): Promise<void>;
  preferences(): Promise<TwoCodePreferences>;
  configurePreferences(input: TwoCodePreferences): Promise<TwoCodePreferences>;
  onDidChange: Event<TwoCodeTask>;
  dispose(): Promise<void>;
}
export const ITwoCodeService: { readonly channelName: string; readonly _brand?: ITwoCodeService } =
  { channelName: "two-code" };
