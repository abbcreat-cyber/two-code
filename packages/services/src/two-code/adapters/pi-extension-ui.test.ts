import test from "node:test";
import assert from "node:assert/strict";
import { handleExtensionUi } from "./pi-extension-ui.js";
import type { EngineEvent } from "../app/ports.js";

test("启动状态通知不弹权限、不回RPC；真正confirm仍等待一次用户决定", async () => {
  const responses: Record<string, unknown>[] = [];
  const events: EngineEvent[] = [];
  const permissions: string[][] = [];
  let decide!: (allow: boolean) => void;
  const input = {
    emit: async (event: EngineEvent) => {
      events.push(event);
    },
    permission: (title: string, detail: string) => {
      permissions.push([title, detail]);
      return new Promise<boolean>((resolve) => {
        decide = resolve;
      });
    },
  };
  for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text", "notify"])
    await handleExtensionUi({ id: method, method, message: "通知" }, input, "Step Code", (r) =>
      responses.push(r),
    );
  assert.equal(permissions.length, 0);
  assert.equal(responses.length, 0);
  assert.deepEqual(events, [{ kind: "message", text: "\nStep Code：通知\n" }]);
  const pending = handleExtensionUi(
    { id: "real-confirm", method: "confirm", title: "执行命令", message: "node check.mjs" },
    input,
    "Step Code",
    (r) => responses.push(r),
  );
  assert.deepEqual(permissions, [["执行命令", "node check.mjs"]]);
  assert.equal(responses.length, 0);
  decide(false);
  await pending;
  assert.deepEqual(responses, [
    { type: "extension_ui_response", id: "real-confirm", confirmed: false },
  ]);
});

test("输入、选择及未知扩展请求显式取消，不把批准按钮伪装成字符串答案", async () => {
  for (const method of ["input", "select", "editor", "future-method"]) {
    const responses: Record<string, unknown>[] = [];
    await assert.rejects(
      handleExtensionUi(
        { id: "q", method },
        {
          permission: async () => {
            assert.fail("不应请求布尔权限");
          },
          emit: async () => {},
        },
        "Pi",
        (r) => responses.push(r),
      ),
      /暂不支持/,
    );
    assert.deepEqual(responses, [{ type: "extension_ui_response", id: "q", cancelled: true }]);
  }
});

test("confirm批准、权限传输失败与无ID请求保持原有失败边界", async () => {
  const responses: Record<string, unknown>[] = [];
  const respond = (r: Record<string, unknown>) => {
    responses.push(r);
  };
  const input = { permission: async () => true, emit: async () => {} };
  await handleExtensionUi({ id: "ok", method: "confirm" }, input, "Pi", respond);
  assert.deepEqual(responses, [{ type: "extension_ui_response", id: "ok", confirmed: true }]);
  await assert.rejects(handleExtensionUi({ method: "confirm" }, input, "Pi", respond), /缺少ID/);
  await assert.rejects(
    handleExtensionUi(
      { id: "offline", method: "confirm" },
      {
        ...input,
        permission: async () => {
          throw Error("权限通道断开");
        },
      },
      "Pi",
      respond,
    ),
    /权限通道断开/,
  );
  assert.equal(responses.length, 1);
});
