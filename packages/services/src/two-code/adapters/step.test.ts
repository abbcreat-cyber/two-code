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
      source!.replace(/import [^\n]+\n/, "").replace("export default function", "return function"),
    );
    factory({ platform: "win32", env: { TWO_CODE_HAS_SIDEKICK: "0" } }, async () => {
      throw Error("offline");
    })(pi);
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
  });
}
