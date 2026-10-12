import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stepConnections } from "./step-connections.js";
import { TwoCodeConnections } from "./connections.js";
import { newTask } from "../domain/task.js";
import { piToolExtension, stepToolExtension } from "./tool-bridge.js";

test("Step Code的API与订阅各自导入、显示和冻结，不按相同模型ID合并", async () => {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/step-");
  await mkdir(join(root, ".stepcode"));
  await writeFile(
    join(root, ".stepcode/models.json"),
    JSON.stringify({
      providers: {
        "step-api": {
          baseUrl: "https://api.stepfun.com/v1",
          api: "openai-completions",
          apiKey: "api-secret",
          models: [{ id: "step-5-preview" }],
        },
        "step-plan": {
          baseUrl: "https://api.stepfun.com/step_plan/v1",
          api: "openai-completions",
          apiKey: "plan-secret",
          models: [{ id: "step-5-preview" }],
        },
      },
    }),
  );
  const connections = await stepConnections(root);
  const manager = new TwoCodeConnections(root, async () => connections);
  const view = await manager.read();
  assert(!JSON.stringify(view).includes("-secret"));
  const catalog = await manager.catalog([
    { id: "step-code", name: "Step Code", available: true, detail: "", models: [] },
  ]);
  assert.deepEqual(
    catalog[0]?.models.map((m) => [m.provider, m.id, m.name]),
    [
      ["step-api", "step-5-preview", "Step-5 API"],
      ["step-plan", "step-5-preview", "Step-5 订阅"],
    ],
  );
  const task = newTask(
    "task",
    {
      workspacePath: root,
      dual: true,
      lead: { harness: "step-code", provider: "step-api", model: "step-5-preview" },
      sidekick: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    },
    "now",
  );
  const frozen = await manager.freeze(task);
  assert.equal(frozen.lead?.apiKey, "api-secret");
  assert.equal(frozen.sidekick?.apiKey, "plan-secret");
  assert.notEqual(frozen.lead?.baseUrl, frozen.sidekick?.baseUrl);
  task.sidekick.selection.provider = "missing";
  await assert.rejects(manager.freeze(task), /连接已移除/);
});

for (const [label, source] of [
  ["Pi", piToolExtension],
  ["Step", stepToolExtension],
]) {
  test(`${label}权限通道断开时拒绝工具，PowerShell存在才启用`, async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    let active = ["run_command"];
    const pi = {
      registerCommand() {},
      registerTool() {},
      on(name: string, fn: (...args: any[]) => any) {
        handlers.set(name, fn);
      },
      getActiveTools: () => active,
      getAllTools: () => [{ name: "powershell" }],
      setActiveTools: (value: string[]) => {
        active = value;
      },
    };
    const factory = new Function(
      "process",
      "fetch",
      "Type",
      source!.replace(/import [^\n]+\n/, "").replace("export default function", "return function"),
    );
    const env = {
      TWO_CODE_HAS_SIDEKICK: "0",
      TWO_CODE_WORKSPACE: "D:/fixture",
      TWO_CODE_NATIVE_BASH: "D:/Git/bin/bash.exe",
    };
    factory(
      { platform: "win32", env },
      async () => {
        throw Error("offline");
      },
      { Object: (v: unknown) => v, String: () => ({ type: "string" }) },
    )(pi);
    handlers.get("session_start")!();
    assert.deepEqual(active, ["run_command", "powershell"]);
    assert.equal(
      (await handlers.get("tool_call")!({ toolName: "powershell", input: { command: "Get-Date" } }))
        .block,
      true,
    );
    assert.equal(
      (await handlers.get("tool_call")!({ toolName: "subagent", input: {} })).block,
      true,
    );
    const before = handlers.get("before_agent_start")!,
      result = handlers.get("tool_result")!;
    const content = [{ type: "text", text: "native edit result" }];
    assert(!before({ systemPrompt: "original" }).systemPrompt.includes("用户明确指定由副手"));
    assert.equal(result({ toolName: "read_file", isError: true, content }), undefined);
    const read = result({ toolName: "read_file", content });
    assert.deepEqual(read.content[0], content[0]);
    assert.match(read.content[1].text, /D:\/fixture/);
    assert.equal(result({ toolName: "read_file", content }), undefined);
    assert.equal(result({ toolName: "edit_file", content }), undefined);
    env.TWO_CODE_HAS_SIDEKICK = "1";
    const prompt = before({ systemPrompt: "original" }).systemPrompt;
    assert(prompt.startsWith("original"));
    assert.match(prompt, /本进程PATH已提供Git Bash/);
    assert.match(prompt, /优先直接使用原生powershell/);
    assert.match(prompt, /调用写入\/修改\/执行工具之前先用sidekick派工/);
    assert.equal(result({ toolName: "edit_file", isError: true, content }), undefined);
    const successful = result({ toolName: "edit_file", content });
    assert.deepEqual(successful.content[0], content[0]);
    assert.match(successful.content[1].text, /已实际完成/);
    assert.match(successful.content[1].text, /如实说明实际执行者/);
    assert.equal(result({ toolName: "edit_file", content }), undefined);
    before({ systemPrompt: "original" });
    assert(result({ toolName: "edit_file", content }));
  });
}
