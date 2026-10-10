import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { TwoCodeConnections } from "../packages/services/src/two-code/adapters/connections.js";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
const root = `D:/Apps/TwoCode/qa/managed-live-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const settings = new TwoCodeConnections(root);
let view = await settings.read();
for (const id of ["native:claude-code", "native:pi:ds-tencent"]) {
  const connection = view.connections.find((c) => c.id === id)!;
  assert(connection);
  view = await settings.save({
    revision: view.revision,
    connection: { ...connection, name: `${connection.name} QA` },
  });
}
const preferences = JSON.parse(await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"));
const service = new TwoCodeCoordinator({
  store: new JsonTaskStore(path.join(root, "tasks")),
  sessionRoot: path.join(root, "sessions"),
  connections: (task) => settings.freeze(task),
  catalog: async () => [],
  validateWorkspace: async (p) => fs.realpath(p),
  createAdapter: (h) => (h === "pi" ? new PiAdapter() : new ClaudeAdapter()),
});
try {
  const task = await service.create({
    workspacePath: root,
    dual: true,
    lead: {
      ...preferences.lead,
      harness: "claude-code",
      provider: undefined,
      model: "claude-sonnet-4-8",
    },
    sidekick: {
      ...preferences.sidekick,
      harness: "pi",
      provider: "ds-tencent",
      model: "claude-sonnet-4-8",
    },
  });
  const frozen = await settings.freeze(task);
  assert(frozen.lead && frozen.sidekick);
  await service.submit({
    taskId: task.id,
    requestId: "managed",
    text: "小任务验收：调用唯一副手心算23乘29，主手核对后报告结果。禁止其他工具、文件操作、联网和加载技能。",
  });
  const deadline = Date.now() + 120000;
  while ((await service.read(task.id)).status === "running") {
    if (Date.now() > deadline) {
      await service.cancel(task.id);
      throw new Error("managed live timeout");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const finished = await service.read(task.id);
  assert.equal(finished.status, "completed", finished.error);
  assert.match(finished.lead.lastReport ?? "", /667/);
  assert.equal(finished.sidekick.status, "completed");
  const piConfig = JSON.parse(
    await fs.readFile(
      path.join(root, "sessions", task.id, "sidekick/connection/models.json"),
      "utf8",
    ),
  );
  assert.equal(piConfig.providers["ds-tencent"].baseUrl, frozen.sidekick.baseUrl);
  assert.equal(piConfig.providers["ds-tencent"].apiKey, frozen.sidekick.apiKey);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({
      task: finished.id,
      passed: true,
      leadSession: finished.lead.sessionId,
      sidekickSession: finished.sidekick.sessionId,
    }),
  );
  console.log(JSON.stringify({ managedConnectionLive: true, root }));
} finally {
  await service.dispose();
}
