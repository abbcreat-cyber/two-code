import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { TwoCodeCoordinator } from "../packages/services/src/two-code/app/coordinator.js";
import { JsonTaskStore } from "../packages/services/src/two-code/adapters/json-store.js";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { PiAdapter } from "../packages/services/src/two-code/adapters/pi.js";
import type {
  TwoCodePreferences,
  TwoCodeTask,
} from "../packages/services/src/two-code/contract.js";

const root = process.argv[2] ?? `D:/Apps/TwoCode/qa/${randomUUID()}`;
await fs.mkdir(root, { recursive: true });
const preferences: TwoCodePreferences = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/preferences.json", "utf8"),
);
const service = new TwoCodeCoordinator({
  sessionRoot: path.join(root, "sessions"),
  store: new JsonTaskStore(path.join(root, "tasks")),
  catalog: async () => [],
  validateWorkspace: async (cwd) => fs.realpath(cwd),
  createAdapter: (harness) => {
    if (harness === "claude-code") return new ClaudeAdapter();
    if (harness === "pi") return new PiAdapter();
    throw new Error("本场验收只运行 Claude Code 与 Pi");
  },
});
const approvals = new Set<string>();
const subscription = service.onDidChange((task) => {
  for (const permission of task.permissions) {
    if (approvals.has(permission.id)) continue;
    approvals.add(permission.id);
    const args: Record<string, unknown> = JSON.parse(permission.detail);
    const filename = typeof args.file_path === "string" ? path.resolve(args.file_path) : "";
    const target = path.resolve(task.workspacePath, "impl.mjs");
    const command = typeof args.command === "string" ? args.command.trim() : "";
    const check = path.join(task.workspacePath, "check.mjs").replaceAll("\\", "/");
    const allow = ["Write", "Edit"].includes(permission.title)
      ? filename === target
      : permission.title === "Read"
        ? filename.startsWith(path.resolve(task.workspacePath) + path.sep)
        : permission.title === "Bash"
          ? ["node check.mjs", `node "${check}"`, `node '${check}'`, `node ${check}`].includes(
              command.replaceAll("\\", "/"),
            )
          : false;
    void service
      .respond({ taskId: task.id, permissionId: permission.id, allow })
      .catch(() => undefined);
    console.log(JSON.stringify({ permission: permission.title, allow }));
  }
});
const results: unknown[] = [];
try {
  for (const direction of ["forward", "reverse"]) {
    const cwd = path.join(root, direction);
    await fs.mkdir(cwd, { recursive: true });
    const check =
      "import assert from 'node:assert/strict';import fs from 'node:fs';import {double} from './impl.mjs';assert.equal(double(4),8);assert.equal(double(-3),-6);fs.writeFileSync(new URL('result.json',import.meta.url),JSON.stringify({passed:true}));console.log('断言通过');";
    await fs.writeFile(path.join(cwd, "check.mjs"), check, "utf8");
    const task = await service.create({
      workspacePath: cwd,
      dual: true,
      lead: direction === "forward" ? preferences.lead : preferences.sidekick,
      sidekick: direction === "forward" ? preferences.sidekick : preferences.lead,
    });
    const started = Date.now();
    await service.submit({
      taskId: task.id,
      requestId: randomUUID(),
      text: `小型双角色验收，限定当前工作目录。必须通过sidekick派工：编写impl.mjs，导出double(x)，返回x*2；然后仅运行一次 node check.mjs。不得修改check.mjs。主手拿到报告后读取impl.mjs和result.json核对，再简短报告。不要联网、不要用GUI、不加载技能、不提交Git。所有面向用户输出中文。`,
    });
    let finished: TwoCodeTask;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      finished = await service.read(task.id);
      if (finished.status !== "running") break;
      if (Date.now() - started > 180000) {
        finished = await service.cancel(task.id);
        break;
      }
    }
    let artifact: unknown;
    try {
      artifact = JSON.parse(await fs.readFile(path.join(cwd, "result.json"), "utf8"));
    } catch {
      artifact = null;
    }
    const unchanged =
      createHash("sha256")
        .update(await fs.readFile(path.join(cwd, "check.mjs")))
        .digest("hex") === createHash("sha256").update(check).digest("hex");
    const passed =
      finished.status === "completed" &&
      finished.sidekick.status === "completed" &&
      unchanged &&
      (artifact as { passed?: boolean } | null)?.passed === true;
    results.push({
      direction,
      elapsedMs: Date.now() - started,
      passed,
      artifact,
      unchanged,
      task: finished,
    });
    await fs.writeFile(path.join(root, "results.json"), JSON.stringify(results, null, 2), "utf8");
    console.log(
      JSON.stringify({
        direction,
        passed,
        status: finished.status,
        error: finished.error,
        lead: finished.lead.actualModel,
        sidekick: finished.sidekick.actualModel,
      }),
    );
    if (!passed) break;
  }
  assert.equal(results.length, 2);
  assert(results.every((result) => (result as { passed: boolean }).passed));
} finally {
  subscription.dispose();
  await service.dispose();
}
console.log(`evidence: ${root}/results.json`);
