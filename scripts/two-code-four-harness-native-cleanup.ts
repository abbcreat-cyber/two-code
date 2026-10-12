import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\four-harness-\d+$/.test(root));
const owner = JSON.parse(await fs.readFile(`${root}/owner.json`, "utf8"));
const closed = JSON.parse(await fs.readFile(`${root}/closed.json`, "utf8"));
assert.equal(owner.kind, "two-code-four-harness-qa");
const tasks = await Promise.all(
  (await fs.readdir(`${root}/data/tasks`))
    .filter((n) => n.endsWith(".json"))
    .map(async (n) => JSON.parse(await fs.readFile(`${root}/data/tasks/${n}`, "utf8"))),
);
for (const t of tasks) {
  assert.notEqual(t.status, "running");
  assert(closed.taskIds.includes(t.id));
  assert(
    path
      .resolve(t.workspacePath)
      .toLowerCase()
      .startsWith(root.toLowerCase() + path.sep),
  );
}
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
process.env.ZCODE_HOME = `${root}/data/.zcode`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { IZCodeAgentService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  zcodeAgentCommandResolver: () => ({
    command: process.execPath,
    args: [
      path.resolve("packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs"),
      "app-server",
      "--stdio",
    ],
    env: { ZCODE_HOME: process.env.ZCODE_HOME! },
  }),
});
const agent = services.get(IZCodeAgentService),
  results: any[] = [];
try {
  for (const t of tasks)
    for (const role of ["lead", "sidekick"]) {
      const a = t[role];
      if (a.selection.harness !== "zcode" || !a.sessionId) continue;
      const target = { workspacePath: t.workspacePath, sessionId: a.sessionId };
      const ack = await agent.sendConversationCommandV4({
        workspacePath: t.workspacePath,
        envelope: {
          commandId: randomUUID(),
          clientId: "two-code-qa-cleanup",
          sessionId: a.sessionId,
          type: "deleteSession",
          payload: {},
          issuedAt: Date.now(),
        },
      });
      assert(["accepted", "noop", "duplicate"].includes(ack.status), ack.message ?? ack.reasonCode);
      let removed = false,
        reason = "";
      try {
        const sub = await agent.subscribeConversationV4({ ...target, visibility: "background" });
        await agent.unsubscribeConversationV4({
          workspacePath: t.workspacePath,
          subscriptionId: sub.ack.subscriptionId,
        });
      } catch (e) {
        reason = String(e);
        removed = /not found|not exist|not_found|不存在|已删除|deleted/i.test(reason);
      }
      results.push({
        taskId: t.id,
        role,
        sessionId: a.sessionId,
        status: ack.status,
        removed,
        reason,
      });
      await agent.disposeWorkspace({ workspacePath: t.workspacePath });
    }
} finally {
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(`${root}/native-session-cleanup.json`, JSON.stringify(results, null, 2));
}
assert(
  results.every((r) => r.removed),
  "部分原生会话删除尚未确认，保留QA目录核对",
);
console.log(JSON.stringify({ zcodeSessionsRemoved: results.length }));
