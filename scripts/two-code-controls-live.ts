import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import type {
  TwoCodePreferences,
  TwoCodeMode,
} from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/controls-live-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const prefs: TwoCodePreferences = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"),
);
const service = new TwoCodeCoordinator({
  sessionRoot: path.join(root, "sessions"),
  store: new JsonTaskStore(path.join(root, "tasks")),
  catalog: async () => [],
  validateWorkspace: async (p) => fs.realpath(p),
  createAdapter: (h) => (h === "pi" ? new PiAdapter() : new ClaudeAdapter()),
});
const pending = new Set<string>();
const requests: Array<{ task: string; tool: string }> = [];
service.onDidChange((task) => {
  for (const p of task.permissions) {
    if (pending.has(p.id)) continue;
    pending.add(p.id);
    requests.push({ task: task.id, tool: p.title });
    void service.respond({ taskId: task.id, permissionId: p.id, allow: false });
  }
});
const results: unknown[] = [];
try {
  for (const selection of [prefs.lead, prefs.sidekick]) {
    const cwd = path.join(root, selection.harness);
    await fs.mkdir(cwd, { recursive: true });
    let task = await service.create({ ...prefs, dual: false, lead: selection, workspacePath: cwd });
    let session: string | undefined;
    for (const mode of ["build", "edit", "plan", "yolo"] as TwoCodeMode[]) {
      const next = {
        ...selection,
        ...(session && selection.harness === "claude-code"
          ? { model: "sonnet", modelLabel: "本机 Sonnet" }
          : {}),
        thinking: "high",
      };
      task = await service.configure({
        taskId: task.id,
        preferences: { ...prefs, dual: false, lead: next, mode },
      });
      const filename = `${mode}.txt`;
      const before = requests.length;
      await service.submit({
        taskId: task.id,
        requestId: mode,
        text: `这是Two Code权限门禁验收，只在当前工作目录操作。当前权限模式是${mode}。请尝试且只尝试一次用Write/write文件工具创建${filename}，内容精确为MODE_OK；如果工具被拒绝，直接报告拒绝，不重试、不换工具。禁止shell、联网、技能、其他文件操作。本轮结束用一句话报告。${mode === "build" ? "记住本会话暗号竹石，不写到文件。" : "最后附上之前记住的暗号。"}`,
      });
      const deadline = Date.now() + 90000;
      do {
        await new Promise((r) => setTimeout(r, 200));
        task = await service.read(task.id);
        if (Date.now() > deadline) {
          await service.cancel(task.id);
          throw new Error(`${selection.harness}/${mode} timeout`);
        }
      } while (task.status === "running");
      const exists = await fs.readFile(path.join(cwd, filename), "utf8").catch(() => null);
      const row = {
        harness: selection.harness,
        mode,
        status: task.status,
        error: task.error,
        exists,
        permissions: requests.slice(before),
        selection: task.lead.selection,
        sessionId: task.lead.sessionId,
        usage: task.usage,
        report: task.lead.lastReport,
      };
      results.push(row);
      await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2));
      console.log(
        JSON.stringify({
          harness: selection.harness,
          mode,
          status: task.status,
          exists,
          permissionCount: requests.length - before,
          receipts: task.usage?.length,
        }),
      );
      assert.equal(task.status, "completed", task.error);
      if (session) {
        assert.equal(task.lead.sessionId, session);
        assert.match(task.lead.lastReport ?? "", /竹石/);
      }
      session = task.lead.sessionId;
      assert.equal(exists, ["edit", "yolo"].includes(mode) ? "MODE_OK" : null);
      assert.equal(requests.length - before, mode === "build" ? 1 : 0);
      assert(task.usage?.length && task.usage.at(-1)!.outputTokens > 0);
    }
  }
  console.log(`PASS ${root}`);
} finally {
  await service.dispose();
}
