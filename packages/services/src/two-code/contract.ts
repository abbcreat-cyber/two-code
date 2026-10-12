import type {
  NamedCombination,
  CombinationsView,
  CombinationsApi,
} from "./combinations-contract.js";
import type { Event } from "@zcode/rpc";
import type { TwoCodeViewsApi } from "./view-contract.js";
export type { TwoCodeViewFrame, TwoCodeViewSnapshot } from "./view-contract.js";
export { projectTwoCodeRows } from "./domain/conversation-rows.js";
export { NativeToolRows } from "./domain/native-tool-rows.js";
export { imageMessage, projectImageMessage } from "./domain/image-message.js";
import type { TwoCodeModelSettingsApi } from "./settings-contract.js";
import type { TwoCodeImagesApi } from "./image-contract.js";
export type { TwoCodeBrowserExecutor } from "./browser-contract.js";
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

export * from "./task-types.js";
import type {
  HarnessInfo,
  TwoCodeTask,
  CreateTwoCodeTask,
  TwoCodePreferences,
} from "./task-types.js";
export type TwoCodeCombination = NamedCombination<TwoCodePreferences>;
export type TwoCodeCombinations = CombinationsView<TwoCodePreferences>;
export type TwoCodeCombinationsApi = CombinationsApi<TwoCodePreferences>;
export interface ITwoCodeService
  extends TwoCodeModelSettingsApi, TwoCodeImagesApi, TwoCodeCombinationsApi, TwoCodeViewsApi {
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
  | keyof TwoCodeCombinationsApi
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
