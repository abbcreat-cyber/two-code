import test from "node:test";
import assert from "node:assert/strict";
import { permissionDenied } from "./permission-feedback.js";
test("拒绝回执给出请求目标与工作区，不泄露其他参数或暗示全局禁用", () => {
  const text = permissionDenied(
    { cwd: "D:/qa/child", mode: "edit", role: "sidekick" },
    "Write",
    JSON.stringify({ file_path: "D:/qa/result.md", content: "not-for-error" }),
  );
  assert.match(text, /D:\/qa\/child/);
  assert.match(text, /D:\/qa\/result.md/);
  assert.match(text, /不代表所有写入/);
  assert(!text.includes("not-for-error"));
  assert.match(
    permissionDenied({ cwd: "D:/qa", role: "sidekick" }, "AskUserQuestion", "{}"),
    /主手/,
  );
});
