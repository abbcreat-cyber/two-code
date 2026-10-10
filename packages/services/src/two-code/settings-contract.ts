import type { Event } from "@zcode/rpc";
export interface ConnectionModel {
  id: string;
  name: string;
  realModel?: string;
  aliases?: string[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}
export interface HarnessConnection {
  authentication?: "chatgpt";
  id: string;
  harness: "claude-code" | "pi";
  provider: string;
  name: string;
  baseUrl: string;
  api: "anthropic-messages" | "openai-completions" | "openai-responses";
  hasApiKey: boolean;
  source: "native" | "two-code";
  models: ConnectionModel[];
}
export interface ModelSettingsView {
  revision: string;
  connections: HarnessConnection[];
}
export interface SaveHarnessConnection {
  revision: string;
  connection: Omit<HarnessConnection, "hasApiKey" | "source">;
  apiKey?: string;
}

export interface TwoCodeModelSettingsApi {
  modelSettings(): Promise<ModelSettingsView>;
  saveConnection(input: SaveHarnessConnection): Promise<ModelSettingsView>;
  removeConnection(input: { id: string; revision: string }): Promise<ModelSettingsView>;
  testConnection(input: {
    id: string;
    revision: string;
    modelId: string;
  }): Promise<{ ok: boolean; message: string }>;
  onDidCatalogChange: Event<void>;
}
