import test from "node:test";
import assert from "node:assert/strict";
import { executeBrowserCommandOnView } from "./browserCommandExecutor.js";
import type { ControlledView } from "./browserCommandTypes.js";

function view(url: string): ControlledView {
  return {
    webContents: {
      loadURL: async () => {},
      getURL: () => url,
      getTitle: () => url,
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      executeJavaScript: async () => null,
    },
    cdp: { send: async () => ({}) },
  };
}
test("loadURL完成但真实页面仍是空白时，不宣称网页导航成功", async () => {
  for (const url of ["", "about:blank"]) {
    const result = await executeBrowserCommandOnView(view(url), {
      method: "navigate",
      url: "https://example.com/page",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "execution_error");
  }
});
test("明确请求空白页以及真实重定向仍可成功", async () => {
  assert.equal(
    (
      await executeBrowserCommandOnView(view("about:blank"), {
        method: "navigate",
        url: "about:blank",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await executeBrowserCommandOnView(view("https://example.org/redirected"), {
        method: "navigate",
        url: "https://example.com/start",
      })
    ).ok,
    true,
  );
});

test("历史命令等待真实完成后读取落点，不能提前返回旧页面", async () => {
  for (const method of ["back", "forward"] as const) {
    const controlled = view("https://example.com/old");
    let url = "https://example.com/old";
    let finish!: () => void;
    controlled.webContents.getURL = () => url;
    controlled.webContents[method === "back" ? "goBack" : "goForward"] = async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      url = "https://example.com/new";
    };
    const pending = executeBrowserCommandOnView(controlled, { method });
    finish();
    const result = await pending;
    assert.equal(result.state?.url, "https://example.com/new");
  }
});
