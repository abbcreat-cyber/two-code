import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { join } from "node:path";
import { permissionDecision as decide } from "./permission-policy.js";

test("副手的递归委派、用户问答和全局目标权限在yolo也不可用，历史与文件工具可用", async () => {
  for (const tool of [
    "Agent",
    "Task",
    "AskUserQuestion",
    "clarify_user",
    "create_goal",
    "update_goal",
    "mcp__two_code__sidekick",
    "SendMessage",
    "workflow",
  ])
    for (const mode of ["plan", "edit", "build", "yolo"] as const)
      assert.equal(await decide(mode, tool, "{}", "D:/fixture", "sidekick"), "deny");
  assert.equal(await decide("yolo", "AskUserQuestion", "{}", "D:/fixture", "lead"), "allow");
  assert.equal(
    await decide("plan", "read_handoff_history", "{}", "D:/fixture", "sidekick"),
    "allow",
  );
  assert.equal(await decide("edit", "Read", "{}", "D:/fixture", "sidekick"), "allow");
});

test("all four modes enforce reads, edits, shells and workspace boundaries", async () => {
  const cwd = "D:/Apps/TwoCode/qa/permission-policy";
  await mkdir(cwd, { recursive: true });
  for (const mode of ["plan", "build", "edit", "yolo"] as const) {
    assert.equal(await decide(mode, "Read", "{}", cwd), "allow");
    assert.equal(await decide(mode, "read_file", "{}", cwd), "allow");
    assert.equal(
      await decide(mode, "powershell", "{}", cwd),
      mode === "plan" ? "deny" : mode === "yolo" ? "allow" : "ask",
    );
    assert.equal(
      await decide(mode, "Write", JSON.stringify({ file_path: "test.txt" }), cwd),
      mode === "plan" ? "deny" : mode === "build" ? "ask" : "allow",
    );
    assert.equal(
      await decide(mode, "bash", "{}", cwd),
      mode === "plan" ? "deny" : mode === "yolo" ? "allow" : "ask",
    );
  }
  assert.equal(
    await decide("edit", "write", JSON.stringify({ path: "../outside.txt" }), cwd),
    "ask",
  );
  assert.equal(await decide("build", "unknown", "{}", cwd), "ask");
  const outside = await mkdtemp(join("D:/Apps/TwoCode/qa/", "outside-"));
  const root = await mkdtemp(join(cwd, "junction-"));
  await symlink(outside, join(root, "escape"), "junction");
  assert.equal(
    await decide("edit", "write", JSON.stringify({ path: "escape/new.txt" }), root),
    "ask",
  );
});
