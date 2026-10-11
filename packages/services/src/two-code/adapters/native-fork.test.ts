import test from "node:test";
import assert from "node:assert/strict";
import { forkPiRecords } from "./native-fork.js";
test("原生树分叉保留工具祖先并排除未来及旁支", () => {
  const text = [
    { type: "session", version: 3, id: "old", cwd: "D:/qa", timestamp: "2026-01-01T00:00:00Z" },
    {
      type: "message",
      id: "a",
      parentId: null,
      timestamp: "2026-01-01T00:00:01Z",
      message: { role: "user", content: "A" },
    },
    {
      type: "message",
      id: "b",
      parentId: "a",
      timestamp: "2026-01-01T00:00:02Z",
      message: { role: "assistant", content: "B" },
    },
    {
      type: "message",
      id: "side",
      parentId: "a",
      timestamp: "2026-01-01T00:00:03Z",
      message: { role: "assistant", content: "SIDE" },
    },
    {
      type: "message",
      id: "c",
      parentId: "b",
      timestamp: "2026-01-01T00:00:04Z",
      message: { role: "toolResult", content: "C" },
    },
    {
      type: "message",
      id: "future",
      parentId: "c",
      timestamp: "2026-01-01T00:00:06Z",
      message: { role: "user", content: "FUTURE" },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");
  const branch = forkPiRecords(text, "2026-01-01T00:00:05Z", "new", "old.jsonl");
  assert(!branch.includes("SIDE"));
  assert(!branch.includes("FUTURE"));
  assert.deepEqual(
    branch
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x).id),
    ["new", "a", "b", "c"],
  );
  assert.throws(
    () =>
      forkPiRecords(
        text.replace('"version":3', '"version":4'),
        "2026-01-01T00:00:05Z",
        "new",
        "old",
      ),
    /格式/,
  );
});
