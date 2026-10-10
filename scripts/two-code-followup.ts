import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";
const root = process.argv[2] ?? "D:/Apps/TwoCode/qa/first-dual";
const prior: Array<{ direction: string; task: TwoCodeTask }> = JSON.parse(
  await fs.readFile(path.join(root, "results.json"), "utf8"),
);
const service = new TwoCodeCoordinator({
  store: new JsonTaskStore(path.join(root, "tasks")),
  sessionRoot: path.join(root, "sessions"),
  catalog: async () => [],
  validateWorkspace: fs.realpath,
  createAdapter: (harness) => (harness === "claude-code" ? new ClaudeAdapter() : new PiAdapter()),
});
try {
  const results = await Promise.all(
    prior.map(async (item) => {
      const old = await service.read(item.task.id),
        cutoff = old.events.at(-1)?.seq ?? 0;
      await service.submit({
        taskId: old.id,
        requestId: randomUUID(),
        text: "使用同一个sidekick，只让它根据会话记忆回答上次编写的导出函数名。副手不要调用任何工具、不读文件、不执行命令。主手也不运行命令、不读文件；收到副手报告后只回答函数名。必须实际调用sidekick，不能主手自己凭记忆代答。",
      });
      const deadline = Date.now() + 120000;
      let current: TwoCodeTask;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        current = await service.read(old.id);
        if (current.status !== "running") break;
        if (Date.now() > deadline) {
          current = await service.cancel(old.id);
          break;
        }
      }
      const events = current.events.filter((event) => event.seq > cutoff);
      assert.equal(current.status, "completed");
      assert.equal(current.lead.sessionId, old.lead.sessionId);
      assert.equal(current.sidekick.sessionId, old.sidekick.sessionId);
      assert(events.some((event) => event.kind === "handoff"));
      assert(!events.some((event) => event.role === "sidekick" && event.kind === "tool"));
      assert.match(current.lead.lastReport ?? "", /double/);
      return {
        direction: item.direction,
        sameLead: true,
        sameSidekick: true,
        sidekickTools: 0,
        reply: current.lead.lastReport,
      };
    }),
  );
  await fs.writeFile(path.join(root, "followup.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(results);
} finally {
  await service.dispose();
}
