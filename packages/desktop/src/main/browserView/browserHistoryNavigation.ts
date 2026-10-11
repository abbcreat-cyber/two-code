import { DEFAULT_NAVIGATE_SETTLE_MS, settleNavigation } from "./browserCommandState.js";

interface HistoryGuest {
  isDestroyed(): boolean;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** 实测历史动作同步返回旧URL；先监听真实主框架完成，再向模型回执，不能用延时猜完成。 */
export async function navigateBrowserHistory(
  guest: HistoryGuest,
  direction: "back" | "forward",
  signal?: AbortSignal,
  timeoutMs = DEFAULT_NAVIGATE_SETTLE_MS,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (guest.isDestroyed()) throw new Error("Browser guest was destroyed");
  const history = guest.navigationHistory;
  if (!(direction === "back" ? history.canGoBack() : history.canGoForward())) return;
  if (!guest.on || !guest.removeListener) throw new Error("Browser navigation events unavailable");
  let started = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const completed = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const handlers: Record<string, (...args: unknown[]) => void> = {
    "did-start-navigation": (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame === true) started = true;
    },
    "did-finish-load": () => {
      if (started) resolve();
    },
    "did-navigate-in-page": (_event, _url, mainFrame) => {
      if (mainFrame === true) resolve();
    },
    "did-fail-load": (_event, code, description, _url, mainFrame) => {
      if (mainFrame === true)
        reject(new Error(`History navigation failed (${String(code)}): ${String(description)}`));
    },
    destroyed: () => reject(new Error("Browser guest was destroyed during history navigation")),
  };
  for (const [event, handler] of Object.entries(handlers)) guest.on(event, handler);
  try {
    // 先建立取消和超时消费端，再触发原生动作；同步事件/异常也不会留下未处理拒绝。
    const pending = settleNavigation(completed, timeoutMs, signal);
    try {
      if (direction === "back") history.goBack();
      else history.goForward();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    await pending;
  } finally {
    for (const [event, handler] of Object.entries(handlers)) guest.removeListener(event, handler);
  }
}
