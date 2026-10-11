import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { StepCodeAdapter } from "../packages/services/src/two-code/adapters/step.js";
import { TwoCodeConnections } from "../packages/services/src/two-code/adapters/connections.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = process.argv[2];
if (!root) throw Error("提供本轮Step真实验收目录");
const previous = JSON.parse(
  await fs.readFile(path.join(root, "second.json"), "utf8"),
) as TwoCodeTask;
const selection = { harness: "step-code" as const, provider: "step-api", model: "step-5-preview" };
const task = { ...previous, dual: false, lead: { ...previous.lead, selection } };
const connection = (await new TwoCodeConnections(path.join(root, "data")).freeze(task)).lead;
const adapter = new StepCodeAdapter(),
  sentinel = Error("STOP_BEFORE_PROMPT");
let observed = "";
try {
  await adapter.run({
    cwd: path.join(root, "workspace"),
    sessionDir: path.join(root, "api-route-only"),
    sessionId: previous.sidekick.sessionId,
    selection,
    connection,
    prompt: "不得发送",
    systemPrompt: "离线路由验收",
    signal: new AbortController().signal,
    permission: async () => false,
    emit: async (event) => {
      if (event.kind === "model") {
        observed = event.text;
        throw sentinel;
      }
    },
  });
  throw Error("不应发送模型任务");
} catch (error) {
  assert.equal(error, sentinel);
  assert.equal(observed, "step-api/step-5-preview");
} finally {
  await adapter.close();
}
await fs.writeFile(
  path.join(root, "api-route-only.json"),
  JSON.stringify(
    { model: observed, restoredSession: previous.sidekick.sessionId, promptSent: false },
    null,
    2,
  ),
);
console.log({ model: observed, promptSent: false });
