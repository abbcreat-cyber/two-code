import type {
  EngineSelection,
  HarnessId,
  HarnessInfo,
  TwoCodeTask,
  TwoCodePreferences,
  TwoCodeMode,
  RunUsage,
  ActorRole,
} from "../contract.js";
export interface EngineEvent {
  blockId?: string;
  availableTools?: string[];
  toolCallId?: string;
  notExecuted?: boolean;
  kind: "message" | "reasoning" | "tool" | "session" | "model";
  text: string;
}
export interface EngineRun {
  role?: ActorRole;
  connection?: EngineConnection;
  mode?: TwoCodeMode;
  usage?(usage: Omit<RunUsage, "id" | "role">): Promise<void>;
  cwd: string;
  sessionDir: string;
  selection: EngineSelection;
  sessionId?: string;
  prompt: string;
  systemPrompt: string;
  signal: AbortSignal;
  emit(event: EngineEvent): Promise<void>;
  permission(title: string, detail: string): Promise<boolean>;
  handoff?: (message: string, block?: boolean) => Promise<string>;
  readSidekick?: () => Promise<string>;
  readHandoffHistory?: (offset?: number) => Promise<string>;
}
export interface EngineConnection {
  subscription?: { agentDir: string; node: string; proxy: string };
  baseUrl: string;
  apiKey: string;
  authMode?: "token" | "api-key";
  modelAliases?: Record<string, string>;
  api: string;
  providerConfig: Record<string, unknown>;
}
export interface EngineReport {
  text: string;
  sessionId?: string;
}
export interface HarnessAdapter {
  update?(message: string): Promise<void>;
  run(input: EngineRun): Promise<EngineReport>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
export interface TaskStore {
  load(): Promise<TwoCodeTask[]>;
  read?(id: string): Promise<TwoCodeTask | undefined>;
  save(task: TwoCodeTask): Promise<void>;
}
export interface CoordinatorDependencies {
  connections?(task: TwoCodeTask): Promise<Partial<Record<"lead" | "sidekick", EngineConnection>>>;
  lease?: {
    isActive(id: string): Promise<boolean>;
    acquire(id: string): Promise<() => Promise<void>>;
  };
  store: TaskStore;
  sessionRoot: string;
  catalog(): Promise<HarnessInfo[]>;
  createAdapter(harness: HarnessId): HarnessAdapter;
  validateWorkspace(path: string): Promise<string>;
  preferences?: {
    read(): Promise<TwoCodePreferences>;
    write(input: TwoCodePreferences): Promise<void>;
  };
}
