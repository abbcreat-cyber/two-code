import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { projectTwoCodeRows } from "../packages/ui/src/two-code/conversationProjection.js";
const root = `D:/Apps/TwoCode/qa/reasoning-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const prefs = JSON.parse(await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"));
const store = new JsonTaskStore(path.join(root, "tasks"));
const service = new TwoCodeCoordinator({
  sessionRoot: path.join(root, "sessions"),
  store,
  catalog: async () => [],
  validateWorkspace: async (cwd) => fs.realpath(cwd),
  createAdapter: (h) => (h === "pi" ? new PiAdapter() : new ClaudeAdapter()),
});
try {
  for (const reverse of [false, true]) {
    const task = await service.create({
      workspacePath: root,
      dual: true,
      lead: reverse ? prefs.sidekick : prefs.lead,
      sidekick: reverse ? prefs.lead : prefs.sidekick,
    });
    await service.submit({
      taskId: task.id,
      requestId: "reasoning",
      text: "小任务验收。必须调用唯一持久副手计算37乘43，自己核对后给出最终答案。不调用文件、终端、联网或其他工具，不加载技能。",
    });
    const deadline = Date.now() + 120000;
    while ((await service.read(task.id)).status === "running") {
      if (Date.now() > deadline) {
        await service.cancel(task.id);
        throw new Error("reasoning live timed out");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const finished = await service.read(task.id);
    assert.equal(finished.status, "completed", finished.error);
    const counts = Object.fromEntries(
      ["lead", "sidekick"].map((role) => [
        role,
        finished.events
          .filter((e) => e.role === role && e.kind === "reasoning")
          .reduce((n, e) => n + e.text.length, 0),
      ]),
    );
    assert(counts.lead! > 0 && counts.sidekick! > 0, "native thinking events missing");
    const replay = await store.read(task.id);
    assert.deepEqual(projectTwoCodeRows(replay), projectTwoCodeRows(finished));
    console.log(
      JSON.stringify({
        reverse,
        counts,
        id: task.id,
        root,
        nativeReasoningRows: projectTwoCodeRows(finished).filter((r) => r.kind === "reasoning")
          .length,
      }),
    );
  }
} finally {
  await service.dispose();
}
