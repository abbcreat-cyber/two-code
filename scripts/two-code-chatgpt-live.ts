import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { TwoCodeConnections } from "../packages/services/src/two-code/adapters/connections.js";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
const root = `D:/Apps/TwoCode/qa/chatgpt-live-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
// 验收与生产使用同一授权所有者，由Pi文件锁协调刷新，不复制可旋转令牌。
await fs.copyFile(
  "D:/Apps/TwoCode/data/chatgpt-connection.json",
  path.join(root, "chatgpt-connection.json"),
);
const manager = new TwoCodeConnections(root);
const service = new TwoCodeCoordinator({
  store: new JsonTaskStore(path.join(root, "tasks")),
  sessionRoot: path.join(root, "sessions"),
  connections: (task) => manager.freeze(task),
  catalog: async () => [],
  validateWorkspace: async (p) => fs.realpath(p),
  createAdapter: () => new PiAdapter(),
});
try {
  const selection = {
    harness: "pi" as const,
    provider: "two-code-chatgpt",
    model: "gpt-6-astra",
    thinking: "low",
  };
  const task = await service.create({
    workspacePath: root,
    dual: false,
    lead: selection,
    sidekick: selection,
  });
  await service.submit({
    taskId: task.id,
    requestId: "native-subscription",
    text: "只输出23乘29的结果，不使用任何工具。",
  });
  const deadline = Date.now() + 60000;
  while ((await service.read(task.id)).status === "running") {
    if (Date.now() > deadline) {
      await service.cancel(task.id);
      throw new Error("Small task timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const result = await service.read(task.id);
  assert.equal(result.status, "completed", result.error);
  assert.match(result.lead.lastReport ?? "", /667/);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ passed: true, task: task.id, report: result.lead.lastReport }),
  );
  console.log(JSON.stringify({ passed: true, root, report: result.lead.lastReport }));
} finally {
  await service.dispose();
  manager.dispose();
}
