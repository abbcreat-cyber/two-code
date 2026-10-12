import test from "node:test";
import assert from "node:assert/strict";
import { runMatrixQueue } from "./two-code-matrix-scheduler.js";
import { directed, profiles } from "./two-code-four-harness-plan.js";

test("矩阵完整覆盖72方向，各配置主副各8次，同脚手架不同模型18种", () => {
  const pairs = directed.flat();
  assert.equal(pairs.length, 72);
  assert.equal(new Set(pairs.map((p) => p.join("-"))).size, 72);
  for (const id of Object.keys(profiles))
    for (const at of [0, 1]) assert.equal(pairs.filter((p) => p[at] === id).length, 8);
  assert.equal(
    pairs.filter(([a, b]) => profiles[a!]!.harness === profiles[b!]!.harness).length,
    18,
  );
});
test("慢任务不阻塞其他空闲名额，且同一配置不会被并发占用", { timeout: 2000 }, async () => {
  const release = Promise.withResolvers<void>(),
    busy = new Set(),
    completed: string[] = [];
  let active = 0;
  await runMatrixQueue(
    [{ pair: ["A", "B"] }, { pair: ["C", "D"] }, { pair: ["E", "F"] }, { pair: ["A", "C"] }],
    async ({ pair }) => {
      for (const id of pair) {
        assert(!busy.has(id));
        busy.add(id);
      }
      assert(++active <= 2);
      if (pair[0] === "A" && pair[1] === "B") await release.promise;
      if (pair[0] === "E") release.resolve();
      completed.push(pair.join("-"));
      active--;
      pair.forEach((id) => busy.delete(id));
    },
    async () => false,
    2,
  );
  assert(completed.indexOf("E-F") < completed.indexOf("A-B"));
  assert.equal(completed.length, 4);
});
