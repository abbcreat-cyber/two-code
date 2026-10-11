import type { HarnessConnection } from "../contract.js";

export interface PrivateConnection extends Omit<HarnessConnection, "hasApiKey" | "source"> {
  subscription?: { agentDir: string; node: string; proxy: string };
  apiKey: string;
  authMode?: "token" | "api-key";
  providerConfig?: Record<string, unknown>;
}
