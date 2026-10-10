import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
import type { TwoCodePreferences } from "../packages/services/src/two-code/contract.js";

const root = `D:/Apps/TwoCode/qa/cancel-${Date.now()}`;
const preferences: TwoCodePreferences = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"),
);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results = await Promise.all(
  [preferences.lead, preferences.sidekick].map(async (selection) => {
    const cwd = path.join(root, selection.harness);
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      path.join(cwd, "wait.mjs"),
      "import fs from 'node:fs';fs.writeFileSync('started.txt','started');setTimeout(()=>{fs.writeFileSync('late.txt','should not exist');},12000);",
    );
    const service = new TwoCodeCoordinator({
      sessionRoot: path.join(cwd, "sessions"),
      store: new JsonTaskStore(path.join(cwd, "tasks")),
      catalog: async () => [],
      validateWorkspace: async (p) => fs.realpath(p),
      createAdapter: (h) => (h === "pi" ? new PiAdapter() : new ClaudeAdapter()),
    });
    const answered = new Set<string>();
    const sub = service.onDidChange((task) => {
      for (const p of task.permissions) {
        if (answered.has(p.id)) continue;
        answered.add(p.id);
        const args = JSON.parse(p.detail);
        const command = String(args.command ?? "")
          .trim()
          .replaceAll("\\", "/");
        const allow =
          p.title === "Bash" &&
          [
            "node wait.mjs",
            `node "${cwd}/wait.mjs"`,
            `node '${cwd}/wait.mjs'`,
            `node ${cwd}/wait.mjs`,
          ].includes(command);
        void service.respond({ taskId: task.id, permissionId: p.id, allow });
      }
    });
    try {
      const task = await service.create({
        workspacePath: cwd,
        dual: false,
        lead: selection,
        sidekick: selection,
      });
      await service.submit({
        taskId: task.id,
        requestId: randomUUID(),
        text: "停止功能验收。当前目录已准备wait.mjs。只执行一次 Bash 命令 node wait.mjs，等待它结束即可。不要读取修改脚本、不加载技能、不用GUI、不做其他操作。",
      });
      const deadline = Date.now() + 100000;
      while (true) {
        if (
          await fs.access(path.join(cwd, "started.txt")).then(
            () => true,
            () => false,
          )
        )
          break;
        const state = await service.read(task.id);
        if (state.status !== "running" || Date.now() > deadline)
          throw new Error(
            `${selection.harness}: real tool did not start (${state.status}: ${state.error})`,
          );
        await delay(100);
      }
      const start = Date.now();
      const stopped = await service.cancel(task.id);
      assert.equal(stopped.status, "cancelled");
      await delay(13000);
      assert.equal(
        await fs.access(path.join(cwd, "late.txt")).then(
          () => true,
          () => false,
        ),
        false,
        "child command survived cancellation",
      );
      const result = {
        harness: selection.harness,
        passed: true,
        cancelMs: Date.now() - start - 13000,
        task: await service.read(task.id),
      };
      await fs.writeFile(path.join(cwd, "result.json"), JSON.stringify(result, null, 2));
      console.log(
        JSON.stringify({ harness: selection.harness, passed: true, cancelMs: result.cancelMs }),
      );
      return result;
    } finally {
      sub.dispose();
      await service.dispose();
    }
  }),
);
await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2));
console.log(`evidence: ${root}`);
