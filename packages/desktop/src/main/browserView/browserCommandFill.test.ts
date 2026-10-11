import test from "node:test";
import assert from "node:assert/strict";
import { executeBrowserCommandOnView } from "./browserCommandExecutor.js";
import type { ControlledView } from "./browserCommandTypes.js";
import { runInNewContext } from "node:vm";
import { VIRTUAL_PASTE_PAGE_FUNCTION } from "./browserVirtualClipboardPageScript.js";

test("fill的ref失效时不向之前聚焦的输入框写入", async () => {
  let inputCalls = 0;
  const view: ControlledView = {
    webContents: {
      loadURL: async () => {},
      getURL: () => "http://localhost/",
      getTitle: () => "fixture",
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      executeJavaScript: async () => null,
    },
    cdp: {
      send: async () => {
        inputCalls++;
        throw Error("不应写入");
      },
    },
  };
  const result = await executeBrowserCommandOnView(view, {
    method: "fill",
    ref: "gone",
    value: "不要写到别的输入框",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "ref_not_found");
  assert.equal(inputCalls, 0);
});

test("后台虚拟输入区分清空、空追加、只读和失去焦点，清空触发input", async () => {
  class Element {
    ownerDocument: unknown;
    shadowRoot = null;
  }
  class Input extends Element {
    stored = "旧内容";
    disabled = false;
    readOnly = false;
    events: string[] = [];
    get value() {
      return this.stored;
    }
    set value(value: string) {
      this.stored = value;
    }
    dispatchEvent(event: { type: string }) {
      this.events.push(event.type);
      return true;
    }
  }
  class Event {
    constructor(public type: string) {}
  }
  const view = {
    Element,
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLTextAreaElement: class extends Element {},
    HTMLIFrameElement: class extends Element {},
    HTMLFrameElement: class extends Element {},
    InputEvent: Event,
  };
  const input = new Input(),
    document = { activeElement: input, defaultView: view };
  input.ownerDocument = document;
  const paste = runInNewContext(`(${VIRTUAL_PASTE_PAGE_FUNCTION})`, { document, window: view });
  const options = {
    clipboardItems: [{ entries: [{ mime_type: "text/plain", text: "" }] }],
    replaceInputValue: false,
  };
  await paste(options);
  assert.equal(input.value, "旧内容");
  assert.deepEqual(input.events, []);
  await paste({ ...options, replaceInputValue: true });
  assert.equal(input.value, "");
  assert.deepEqual(input.events, ["input"]);
  input.value = "只读内容";
  input.readOnly = true;
  await paste({ ...options, replaceInputValue: true });
  assert.equal(input.value, "只读内容");
  input.readOnly = false;
  await assert.rejects(
    paste({ ...options, replaceInputValue: true, inputTargetToken: "wrong" }),
    /expected input target/,
  );
  assert.equal(input.value, "只读内容");
});
