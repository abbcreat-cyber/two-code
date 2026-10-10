import test from "node:test";
import assert from "node:assert/strict";
import { projectTwoCodeUsage } from "./usageProjection.js";
import type { TwoCodeTask } from "@zcode/services";

test("sum both roles, keep unknown timings unavailable, do not invent legacy usage", () => {
  const task: TwoCodeTask = {
    id: "id",
    title: "test",
    workspacePath: "D:/test",
    dual: true,
    status: "idle",
    lead: { selection: { harness: "pi" }, status: "idle" },
    sidekick: { selection: { harness: "claude-code" }, status: "idle" },
    events: [],
    permissions: [],
    requestIds: [],
    updatedAt: "now",
  };
  assert.equal(projectTwoCodeUsage(task), null);
  task.usage = ["lead", "sidekick"].map((role, i) => ({
    id: String(i),
    role: role as "lead" | "sidekick",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 0,
    steps: 1,
    modelMs: i ? null : 1000,
    toolMs: null,
    ttftMs: null,
  }));
  const projected = projectTwoCodeUsage(task)!;
  assert.deepEqual(projected.cumulative, {
    inputTokens: 20,
    outputTokens: 40,
    cacheReadTokens: 60,
    cacheWriteTokens: 0,
  });
  assert.equal(projected.statistics?.tokensPerSecond, 20);
  assert.equal(projected.statistics?.toolMs, null);
  assert.equal(projected.contextWindow, null);
});
