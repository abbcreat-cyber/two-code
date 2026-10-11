import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { navigateBrowserHistory } from "./browserHistoryNavigation.js";

function fixture(action: (events: EventEmitter) => void) {
  const events = new EventEmitter();
  const guest = Object.assign(events, {
    isDestroyed: () => false,
    navigationHistory: {
      canGoBack: (): boolean => true,
      canGoForward: (): boolean => true,
      goBack: () => action(events),
      goForward: () => action(events),
    },
  });
  return guest;
}

test("跨文档等待主框架加载，同文档提交即可完成，所有监听均被回收", async () => {
  for (const direction of ["back", "forward"] as const) {
    for (const inPage of [false, true]) {
      const guest = fixture((events) => {
        events.emit("did-start-navigation", {}, "new", inPage, true);
        queueMicrotask(() => {
          if (inPage) events.emit("did-navigate-in-page", {}, "new", true);
          else events.emit("did-finish-load");
        });
      });
      await navigateBrowserHistory(guest, direction);
      assert.deepEqual(guest.eventNames(), []);
    }
  }
});

test("子框架事件不能提前完成历史动作", async () => {
  const guest = fixture((events) => {
    events.emit("did-start-navigation", {}, "frame", false, false);
    events.emit("did-navigate-in-page", {}, "frame", false);
    events.emit("did-fail-load", {}, -7, "frame failed", "frame", false);
    events.emit("did-finish-load");
  });
  await assert.rejects(navigateBrowserHistory(guest, "back", undefined, 10), /timed out/);
  assert.deepEqual(guest.eventNames(), []);
});

test("无历史条目不触发导航，预取消不执行动作", async () => {
  const guest = fixture(() => {
    throw Error("不应执行");
  });
  guest.navigationHistory.canGoBack = () => false;
  await navigateBrowserHistory(guest, "back");
  await assert.rejects(navigateBrowserHistory(guest, "forward", AbortSignal.abort()), {
    name: "AbortError",
  });
  assert.deepEqual(guest.eventNames(), []);
});

test("导航失败、销毁、同步异常和进行中取消均失败并清理", async () => {
  for (const mode of ["failed", "destroyed", "throw", "abort"]) {
    const controller = new AbortController();
    const guest = fixture((events) => {
      if (mode === "failed") events.emit("did-fail-load", {}, -105, "failed", "new", true);
      if (mode === "destroyed") events.emit("destroyed");
      if (mode === "throw") throw Error("native failure");
      if (mode === "abort") controller.abort();
    });
    await assert.rejects(navigateBrowserHistory(guest, "back", controller.signal));
    assert.deepEqual(guest.eventNames(), []);
  }
});
