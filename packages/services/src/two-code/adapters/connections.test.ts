import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TwoCodeConnections } from "./connections.js";
import type { PrivateConnection } from "./native-connections.js";
import { newTask } from "../domain/task.js";
const native: PrivateConnection = {
  id: "native:pi:demo",
  harness: "pi",
  provider: "demo",
  name: "原连接",
  api: "openai-completions",
  baseUrl: "https://example.invalid/v1",
  apiKey: "private-native-key",
  providerConfig: { headers: { Authorization: "private-header" } },
  models: [{ id: "model-a", name: "模型 A", reasoning: true, contextWindow: 32000 }],
};
async function fixture() {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/connections-");
  return { root, manager: new TwoCodeConnections(root, async () => [structuredClone(native)]) };
}

test("未编辑过的Claude本机API连接也冻结到适配器，图片转换不能被原生直通绕过", async () => {
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/claude-native-");
  const manager = new TwoCodeConnections(root, async () => [
    {
      ...native,
      id: "native:claude-code",
      harness: "claude-code",
      provider: "",
      api: "anthropic-messages",
      baseUrl: "http://127.0.0.1:43153",
    },
  ]);
  const task = newTask(
    "task",
    {
      workspacePath: root,
      dual: false,
      lead: { harness: "claude-code", model: "model-a" },
      sidekick: { harness: "pi" },
    },
    "now",
  );
  assert.equal((await manager.freeze(task)).lead?.baseUrl, "http://127.0.0.1:43153");
  assert(!JSON.stringify(await manager.read()).includes("private-native-key"));
});
test("managed overrides keep keys private, preserve native config, and freeze execution settings", async () => {
  const { root, manager } = await fixture();
  const before = await manager.read();
  assert(!JSON.stringify(before).includes("private-"));
  const saved = await manager.save({
    revision: before.revision,
    connection: { ...before.connections[0]!, name: "Two Code连接" },
    apiKey: "",
  });
  assert.equal(saved.connections[0]!.source, "two-code");
  assert.equal(saved.connections[0]!.hasApiKey, true);
  assert(!JSON.stringify(saved).includes("private-"));
  const task = newTask(
    "task",
    {
      workspacePath: root,
      dual: false,
      lead: { harness: "pi", provider: "demo", model: "model-a" },
      sidekick: { harness: "pi" },
    },
    "now",
  );
  const frozen = await manager.freeze(task);
  assert.equal(frozen.lead?.apiKey, "private-native-key");
  await manager.save({
    revision: saved.revision,
    connection: saved.connections[0]!,
    apiKey: "replacement-key",
  });
  assert.equal(frozen.lead?.apiKey, "private-native-key");
  assert.equal((await manager.freeze(task)).lead?.apiKey, "replacement-key");
  assert.equal(native.apiKey, "private-native-key");
  assert.equal(
    JSON.parse(await readFile(join(root, "model-connections.json"), "utf8")).connections[0].apiKey,
    "replacement-key",
  );
});
test("concurrent stale writes and duplicate model IDs are rejected without overwriting", async () => {
  const { manager } = await fixture();
  const initial = await manager.read();
  const saved = await manager.save({
    revision: initial.revision,
    connection: initial.connections[0]!,
  });
  await assert.rejects(
    manager.save({ revision: initial.revision, connection: initial.connections[0]! }),
    /其他窗口/,
  );
  await assert.rejects(
    manager.save({
      revision: saved.revision,
      connection: { ...saved.connections[0]!, models: [native.models[0]!, native.models[0]!] },
    }),
    /重复/,
  );
  assert.equal((await manager.read()).revision, saved.revision);
});
test("removal persists across reload and never falls back to deleted native connections", async () => {
  const { root, manager } = await fixture();
  const initial = await manager.read();
  await manager.remove({ id: native.id, revision: initial.revision });
  const restored = new TwoCodeConnections(root, async () => [structuredClone(native)]);
  assert.equal((await restored.read()).connections.length, 0);
  const task = newTask(
    "task",
    {
      workspacePath: root,
      dual: false,
      lead: { harness: "pi", provider: "demo", model: "model-a" },
      sidekick: { harness: "pi" },
    },
    "now",
  );
  await assert.rejects(restored.freeze(task), /移除/);
});
