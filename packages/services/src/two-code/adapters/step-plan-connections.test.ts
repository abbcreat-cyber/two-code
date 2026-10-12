import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { nativeConnections } from "./native-connections.js";
import { TwoCodeConnections } from "./connections.js";
import { claudeConnection } from "./claude-connection.js";
import { newTask } from "../domain/task.js";

async function fixture(t: test.TestContext, url = "https://api.stepfun.com/step_plan/v1") {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/step-plan-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".stepcode"));
  const file = join(root, ".stepcode/models.json");
  await writeFile(
    file,
    JSON.stringify({
      providers: {
        "step-plan": {
          baseUrl: url,
          api: "openai-completions",
          apiKey: "private-plan-key",
          models: [
            {
              id: "step-5-preview",
              input: ["text", "image"],
              reasoning: true,
              contextWindow: 256000,
              maxTokens: 256000,
              compat: { stepcodeDesktop: { protocol: "openai-completions" } },
            },
          ],
        },
        "step-api": {
          baseUrl: "https://api.stepfun.com/v1",
          apiKey: "private-api-key",
          models: [{ id: "step-5-preview" }],
        },
      },
    }),
  );
  return { root, file, manager: new TwoCodeConnections(root, () => nativeConnections(root)) };
}

test("Step订阅原生导入Pi及Claude，协议/图像/档位冻结且不泄露密钥，不导入API渠道", async (t) => {
  const { root, file, manager } = await fixture(t);
  t.after(() => manager.dispose());
  const original = await readFile(file, "utf8");
  const view = await manager.read();
  assert(!JSON.stringify(view).includes("private-"));
  for (const harness of ["pi", "claude-code"] as const) {
    const c = view.connections.find((c) => c.harness === harness && c.provider === "step-plan")!;
    assert.equal(c.name, "Step-5 订阅");
    assert.equal(c.models[0]?.name, "Step-5 订阅");
    assert(!view.connections.some((c) => c.harness === harness && c.provider === "step-api"));
    const task = newTask(
      "t",
      {
        workspacePath: root,
        dual: false,
        lead: { harness, provider: "step-plan", model: "step-5-preview", thinking: "medium" },
        sidekick: { harness: "pi" },
      },
      "now",
    );
    const frozen = (await manager.freeze(task)).lead!;
    assert.equal(frozen.apiKey, "private-plan-key");
    const models = frozen.providerConfig!.models as Array<Record<string, unknown>>;
    assert(models[0]);
    assert.deepEqual(models[0].input, ["text", "image"]);
    assert.equal(models[0].contextWindow, 256000);
    assert(!JSON.stringify(models[0]).includes("stepcodeDesktop"));
    assert.equal((models[0].thinkingLevelMap as Record<string, string>).medium, "medium");
    if (harness === "claude-code") {
      assert.equal(frozen.api, "anthropic-messages");
      const connection = await claudeConnection(frozen);
      assert.equal(connection.env?.ANTHROPIC_BASE_URL, "https://api.stepfun.com/step_plan");
      assert.equal(connection.env?.ANTHROPIC_AUTH_TOKEN, "private-plan-key");
      assert.equal(connection.env?.ANTHROPIC_API_KEY, "");
      await connection.close();
    } else assert.equal(frozen.baseUrl, "https://api.stepfun.com/step_plan/v1");
  }
  const c = view.connections.find((c) => c.id === "native:pi:step-plan")!;
  const saved = await manager.save({
    revision: view.revision,
    connection: { ...c, name: "订阅改名" },
  });
  assert.equal(saved.connections.find((v) => v.id === c.id)?.name, "订阅改名");
  await manager.remove({ id: c.id, revision: saved.revision });
  assert(!(await manager.read()).connections.some((v) => v.id === c.id));
  assert.equal(await readFile(file, "utf8"), original);
});

test("已有Pi同provider保留唯一原配置，不覆盖为Step导入值", async (t) => {
  const { root } = await fixture(t);
  await mkdir(join(root, ".pi/agent"), { recursive: true });
  await writeFile(
    join(root, ".pi/agent/models.json"),
    JSON.stringify({
      providers: {
        "step-plan": {
          baseUrl: "https://example.invalid/v1",
          apiKey: "existing-key",
          models: [{ id: "custom", name: "已有" }],
        },
      },
    }),
  );
  const imports = (await nativeConnections(root)).filter(
    (c) => c.harness === "pi" && c.provider === "step-plan",
  );
  assert.equal(imports.length, 1);
  assert(imports[0]);
  assert.equal(imports[0].apiKey, "existing-key");
  assert.equal(imports[0].models[0]?.id, "custom");
});

test("自定义Step订阅地址不猜测Anthropic路径、不转送凭据", async (t) => {
  const { root } = await fixture(t, "https://example.invalid/step_plan/v1");
  const imports = await nativeConnections(root);
  assert.equal(imports.filter((c) => c.provider === "step-plan").length, 1);
  assert.equal(imports.find((c) => c.provider === "step-plan")?.harness, "step-code");
});
