import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\(?:four-harness|zcode-v4)-\d+$/.test(root));
const owner = JSON.parse(await fs.readFile(`${root}/owner.json`, "utf8"));
const closed = JSON.parse(await fs.readFile(`${root}/closed.json`, "utf8"));
assert.equal(
  owner.kind,
  path.basename(root).startsWith("zcode-v4-") ? "two-code-zcode-v4-qa" : "two-code-four-harness-qa",
);
assert.equal(path.resolve(owner.root), root);
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
const { IZCodeTaskService } = await import("../packages/services/src/index.js");
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
const taskService = services.get(IZCodeTaskService),
  results: any[] = [];
try {
  for (const t of tasks)
    for (const role of ["lead", "sidekick"]) {
      const a = t[role];
      if (a.selection.harness !== "zcode" || !a.sessionId) continue;
      const target = { workspacePath: t.workspacePath, taskId: a.sessionId };
      // 原生删除语义是持久隐藏，CLI历史仍保留；不能把deleteSession的ACK当物理删除。
      await taskService.deleteTask(target);
      const deletedIds = await taskService.listDeletedTaskIds({ workspacePath: t.workspacePath });
      const visible = await taskService.listTasks({ workspacePath: t.workspacePath });
      const removed =
        deletedIds.includes(a.sessionId) && !visible.some((item) => item.id === a.sessionId);
      results.push({
        taskId: t.id,
        role,
        sessionId: a.sessionId,
        removed,
        nativeHistoryRetained: true,
      });
    }
} finally {
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(`${root}/native-session-cleanup.json`, JSON.stringify(results, null, 2));
}
assert(
  results.every((r) => r.removed),
  "部分原生会话删除尚未确认，保留QA目录核对",
);
console.log(JSON.stringify({ zcodeTasksHidden: results.length, nativeHistoryRetained: true }));
