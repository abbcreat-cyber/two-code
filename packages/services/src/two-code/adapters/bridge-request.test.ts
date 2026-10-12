import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { requestBridge } from "./bridge-request.js";
import { piToolExtension, stepToolExtension } from "./tool-bridge.js";

test("实际生成的Pi/Step扩展能调用独立HTTP传输，不依赖构建器辅助变量", async (t) => {
  const server = createServer((_req, res) => res.end('{"text":"真实报告"}'));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  for (const source of [piToolExtension, stepToolExtension]) {
    const tools = new Map<string, any>();
    const factory = new Function(
      "process",
      "Type",
      source.replace(/import [^\n]+\n/, "").replace("export default function", "return function"),
    );
    factory(
      {
        env: {
          TWO_CODE_HAS_SIDEKICK: "1",
          TWO_CODE_TOOL_URL: `http://127.0.0.1:${address.port}`,
          TWO_CODE_TOOL_TOKEN: "fixture",
        },
      },
      new Proxy({}, { get: () => (value: unknown) => value }),
    )({
      registerCommand() {},
      on() {},
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
    });
    const result = await tools
      .get("sidekick")
      .execute("id", { message: "brief" }, new AbortController().signal);
    assert.deepEqual(result.content, [{ type: "text", text: "真实报告" }]);
  }
});

test("桥接等待完整JSON且不重试，HTTP失败与解析失败保持真实", async (t) => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, "Bearer fixture");
    if (req.url === "/invalid") return void res.end("not-json");
    if (req.url === "/error") {
      res.statusCode = 400;
      return void res.end('{"error":"rejected"}');
    }
    setTimeout(() => res.end('{"text":"真实报告"}'), 70);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  assert.deepEqual(await requestBridge(url, "fixture", { name: "sidekick" }), {
    ok: true,
    result: { text: "真实报告" },
  });
  assert.deepEqual(await requestBridge(url + "/error", "fixture", {}), {
    ok: false,
    result: { error: "rejected" },
  });
  await assert.rejects(requestBridge(url + "/invalid", "fixture", {}), SyntaxError);
  assert.equal(calls, 3);
});

test("取消长等待关闭唯一连接，连接断开也拒绝，不能重试派工", async (t) => {
  let calls = 0;
  const received = Promise.withResolvers<void>(),
    closed = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    calls++;
    if (req.url === "/break") return res.destroy();
    res.on("close", () => closed.resolve());
    received.resolve();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  const pending = requestBridge(url, "fixture", {}, controller.signal);
  await received.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await closed.promise;
  await assert.rejects(requestBridge(url + "/break", "fixture", {}));
  assert.equal(calls, 2);
});
