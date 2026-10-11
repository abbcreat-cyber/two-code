import test from "node:test";
import assert from "node:assert/strict";
import { newTask } from "../domain/task.js";
import { assertHandoffWorkspace } from "../domain/handoff-workspace.js";
test("配置目录不能冒充工作区；真实视觉产物和用户明确要求仍可交接", () => {
  const task = newTask(
    "fixture",
    {
      workspacePath: "D:/work",
      dual: true,
      lead: { harness: "step-code" },
      sidekick: { harness: "claude-code" },
    },
    "now",
  );
  task.events = [
    { seq: 1, at: "now", role: "user", kind: "message", text: "修复当前目录card.svg" },
  ];
  assert.throws(
    () =>
      assertHandoffWorkspace(
        task,
        "编辑 D:\\sessions\\fixture\\lead\\connection\\agent\\card.svg",
        "D:/sessions/fixture",
      ),
    /派工尚未执行/,
  );
  assert.doesNotThrow(() => assertHandoffWorkspace(task, "编辑card.svg", "D:/sessions/fixture"));
  assert.throws(
    () =>
      assertHandoffWorkspace(task, "写入D:/sessions/fixture/receipt.json", "D:/sessions/fixture"),
    /派工尚未执行/,
  );
  assert.throws(
    () => assertHandoffWorkspace(task, '工作目录="D:/sessions/fixture"', "D:/sessions/fixture"),
    /派工尚未执行/,
  );
  assert.doesNotThrow(() =>
    assertHandoffWorkspace(task, "写D:/sessions/fixture-copy/receipt.json", "D:/sessions/fixture"),
  );
  assert.doesNotThrow(() =>
    assertHandoffWorkspace(
      task,
      "查看D:/sessions/fixture/lead/visual/a.png",
      "D:/sessions/fixture",
    ),
  );
  task.events[0]!.text = "请检查D:/sessions/fixture/lead/connection/models.json";
  assert.doesNotThrow(() =>
    assertHandoffWorkspace(
      task,
      "检查D:/sessions/fixture/lead/connection/models.json",
      "D:/sessions/fixture",
    ),
  );
  task.workspacePath = "D:/sessions/fixture/my-work";
  task.events[0]!.text = "在工作区写receipt.json";
  assert.throws(
    () => assertHandoffWorkspace(task, "写D:/sessions/fixture/receipt.json", "D:/sessions/fixture"),
    /派工尚未执行/,
  );
  assert.doesNotThrow(() =>
    assertHandoffWorkspace(
      task,
      "写D:/sessions/fixture/my-work/receipt.json",
      "D:/sessions/fixture",
    ),
  );
});
