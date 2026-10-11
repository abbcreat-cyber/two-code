import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { executeTaskBrowser, runBrowserTool } from "./browser.js";
import { ToolBridge } from "./tool-bridge.js";
import { newTask } from "../domain/task.js";
import { permissionDecision } from "../app/permission-policy.js";
import type { EngineRun } from "../app/ports.js";
import type { TwoCodeBrowserExecutor } from "../browser-contract.js";

function input(extra: Partial<EngineRun> = {}): EngineRun {
  return {
    cwd: "D:/fixture",
    sessionDir: "D:/fixture/session",
    selection: { harness: "step-code" },
    prompt: "",
    systemPrompt: "",
    signal: new AbortController().signal,
    permission: async () => true,
    emit: async () => {},
    ...extra,
  };
}
test("内置浏览器权限区分观察与变更，内部命令即使yolo也不开放", async () => {
  for (const tool of ["browser", "mcp__two_code__browser"])
    for (const mode of ["plan", "edit", "build", "yolo"] as const) {
      assert.equal(
        await permissionDecision(
          mode,
          tool,
          JSON.stringify({ request: '{"method":"snapshot"}' }),
          "D:/fixture",
        ),
        "allow",
      );
      assert.equal(
        await permissionDecision(
          mode,
          tool,
          JSON.stringify({ request: '{"method":"navigate","url":"https://example.com"}' }),
          "D:/fixture",
        ),
        mode === "plan" ? "deny" : mode === "yolo" ? "allow" : "ask",
      );
      assert.equal(
        await permissionDecision(
          mode,
          tool,
          JSON.stringify({ request: '{"method":"claimTab","tabId":"foreign"}' }),
          "D:/fixture",
        ),
        "deny",
      );
    }
});
test("共享前端任务scope，不用原生角色session；其他任务有独立scope与requestId", async () => {
  const received: Array<Parameters<TwoCodeBrowserExecutor["execute"]>[0]> = [];
  const executor: TwoCodeBrowserExecutor = {
    list: async () => [
      { id: "iab-test", generation: 7, type: "iab", name: "test", capabilities: {} },
    ],
    execute: async (args) => {
      received.push(args);
      return { ok: true, elapsedMs: 1 };
    },
  };
  const task = newTask(
    "task-a",
    {
      workspacePath: "D:/fixture",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    new Date().toISOString(),
  );
  await executeTaskBrowser(executor, task, { method: "getState" });
  await executeTaskBrowser(executor, task, { method: "list" });
  await executeTaskBrowser(executor, { ...task, id: "task-b" }, { method: "list" });
  assert.deepEqual(
    received.map((v) => v.sessionId),
    ["two-code:task-a", "two-code:task-a", "two-code:task-b"],
  );
  assert(received.every((v) => v.workspaceKey === "D:/fixture" && v.browserGeneration === 7));
  assert.equal(new Set(received.map((v) => v.requestId)).size, 3);
});
test("像素作为原生image返回，错误保留结构化事实且不降级到其他浏览器", async () => {
  const output = await runBrowserTool(
    input({
      browser: async () => ({
        ok: true,
        elapsedMs: 1,
        image: { base64: "PIXELS", mimeType: "image/png" },
      }),
    }),
    '{"method":"screenshot"}',
  );
  assert.deepEqual(output.content[1], { type: "image", data: "PIXELS", mimeType: "image/png" });
  assert(!JSON.stringify(output.content[0]).includes("PIXELS"));
  const fail = await runBrowserTool(
    input({
      browser: async () => ({
        ok: false,
        elapsedMs: 0,
        error: { code: "backend_unavailable", message: "gone" },
      }),
    }),
    '{"method":"list"}',
  );
  assert.equal(fail.isError, true);
  await assert.rejects(runBrowserTool(input(), '{"method":"list"}'), /未连接/);
});

test("结构化request与JSON字符串走相同命令校验和权限路径", async () => {
  let calls = 0;
  for (const request of [{ method: "snapshot" }, '{"method":"snapshot"}']) {
    const response = await runBrowserTool(
      input({
        browser: async (command) => {
          assert.equal(command.method, "snapshot");
          calls++;
          return { ok: true, elapsedMs: 0 };
        },
        permission: (tool, detail) =>
          permissionDecision("plan", tool, detail, "D:/fixture").then((v) => v === "allow"),
      }),
      request,
    );
    assert.equal(response.isError, false);
  }
  await assert.rejects(
    runBrowserTool(
      input({
        browser: async () => {
          calls++;
          return { ok: true, elapsedMs: 0 };
        },
      }),
      { method: "list", sessionId: "foreign" },
    ),
  );
  assert.equal(calls, 2);
});

test("发现浏览器过程中取消，不补发已经过期的导航", async () => {
  const abort = new AbortController();
  let calls = 0;
  const executor: TwoCodeBrowserExecutor = {
    list: async () => {
      abort.abort();
      return [{ id: "iab-test", generation: 1, type: "iab", name: "test", capabilities: {} }];
    },
    execute: async () => {
      calls++;
      return { ok: true, elapsedMs: 0 };
    },
  };
  const task = newTask(
    "cancelled",
    {
      workspacePath: "D:/fixture",
      dual: false,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    new Date().toISOString(),
  );
  await assert.rejects(
    executeTaskBrowser(
      executor,
      task,
      { method: "navigate", url: "https://example.com" },
      abort.signal,
    ),
  );
  assert.equal(calls, 0);
});
test("权限拒绝与取消都不能发出浏览器动作，非法scope字段也不能透传", async () => {
  let calls = 0;
  const browser: NonNullable<EngineRun["browser"]> = async () => {
    calls++;
    return { ok: true, elapsedMs: 0 };
  };
  await assert.rejects(
    runBrowserTool(input({ browser, permission: async () => false }), '{"method":"newTab"}'),
    /未获批准|拒绝|denied/,
  );
  await assert.rejects(
    runBrowserTool(input({ browser, signal: AbortSignal.abort() }), '{"method":"list"}'),
  );
  await assert.rejects(runBrowserTool(input({ browser }), '{"method":"list","sessionId":"other"}'));
  assert.equal(calls, 0);
});
test("工具桥按Host能力公布browser并保留原生截图image，不需主手handoff能力", async () => {
  for (const enabled of [false, true]) {
    const bridge = new ToolBridge(
      input(
        enabled
          ? {
              browser: async () => ({
                ok: true,
                elapsedMs: 0,
                image: { base64: "PIXELS", mimeType: "image/png" },
              }),
            }
          : {},
      ),
    );
    await bridge.start();
    try {
      const call = async (method: string, params = {}) =>
        (
          await fetch(bridge.config.url, {
            method: "POST",
            headers: { ...bridge.config.headers, "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          })
        ).json();
      const list = z
        .object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) })
        .parse(await call("tools/list"));
      assert.equal(
        list.result.tools.some((v: { name: string }) => v.name === "browser"),
        enabled,
      );
      if (enabled) {
        const raw = await call("tools/call", {
          name: "browser",
          arguments: { request: '{"method":"screenshot"}' },
        });
        const result = z
          .object({
            result: z.object({ content: z.array(z.object({ data: z.string().optional() })) }),
          })
          .parse(raw);
        assert.equal(result.result.content[1]?.data, "PIXELS");
      }
    } finally {
      await bridge.close();
    }
  }
});
