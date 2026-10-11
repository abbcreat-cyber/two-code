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
