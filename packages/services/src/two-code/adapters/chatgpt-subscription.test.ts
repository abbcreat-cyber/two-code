import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TwoCodeConnections } from "./connections.js";
import { subscriptionEnvironment } from "./chatgpt-subscription.js";
import { newTask } from "../domain/task.js";

test("subscription catalog hides credential paths, pins endpoint and preserves shared auth after rename", async () => {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/chatgpt-");
  const config = {
    agentDir: join(root, "private-auth"),
    node: "private-node",
    proxy: "http://127.0.0.1:7897",
    models: [{ id: "gpt-6-astra", name: "GPT-6 Astra" }],
  };
  await writeFile(join(root, "chatgpt-connection.json"), JSON.stringify(config));
  const manager = new TwoCodeConnections(root, async () => []);
  let view = await manager.read();
  assert.equal(view.connections[0]!.authentication, "chatgpt");
  assert(!JSON.stringify(view).includes("private-"));
  for (const changes of [
    { baseUrl: "https://example.invalid/v1" },
    { api: "openai-completions" as const },
  ])
    await assert.rejects(
      manager.save({
        revision: view.revision,
        connection: { ...view.connections[0]!, ...changes },
      }),
      /套餐/,
    );
  await assert.rejects(
    manager.save({ revision: view.revision, connection: view.connections[0]!, apiKey: "fake" }),
    /套餐/,
  );
  view = await manager.save({
    revision: view.revision,
    connection: { ...view.connections[0]!, name: "我的套餐" },
  });
  assert.equal(view.connections[0]!.name, "我的套餐");
  const selection = { harness: "pi" as const, provider: "two-code-chatgpt", model: "gpt-6-astra" };
  const task = newTask(
    "test",
    { workspacePath: root, dual: true, lead: selection, sidekick: selection },
    "now",
  );
  const frozen = await manager.freeze(task);
  assert.equal(frozen.lead?.subscription?.agentDir, config.agentDir);
  assert.equal(frozen.sidekick?.subscription?.agentDir, config.agentDir);
  const env = subscriptionEnvironment(frozen.lead!.subscription!);
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
  await manager.remove({ id: view.connections[0]!.id, revision: view.revision });
  assert.equal((await manager.read()).connections.length, 0);
  await assert.rejects(manager.freeze(task), /移除/);
  manager.dispose();
});
