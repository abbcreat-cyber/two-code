import type { BrowserBackendDescriptor, BrowserClientMode, BrowserCommand } from "@zcode/shared";
export interface TwoCodeBrowserContext {
  requestId: string;
  sessionId: string;
  workspaceKey: string;
  workspacePath: string;
  clientMode: BrowserClientMode;
  sessionContext: "live" | "cached";
}
/** 复用窗口Host已有的内置浏览器端口；不持有浏览器或标签页状态。 */
export interface TwoCodeBrowserExecutor {
  list(input: TwoCodeBrowserContext): Promise<BrowserBackendDescriptor[]>;
  execute(
    input: TwoCodeBrowserContext & {
      browserId?: string;
      browserGeneration?: number;
      command: BrowserCommand;
    },
  ): Promise<{ ok: boolean; [key: string]: unknown }>;
}
