import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nativeConnections } from "../packages/services/src/two-code/adapters/native-connections.js";
import { nativeModels } from "./two-code-role-swap-metrics.js";

const root = `D:/Apps/TwoCode/qa/glm-coordination-${Date.now()}`;
await fs.mkdir(root + "/data", { recursive: true });
await fs.mkdir(root + "/workspace");
await fs.writeFile(
  root + "/owner.json",
  JSON.stringify({ kind: "two-code-glm-coordination-qa", root }),
);
await fs.writeFile(root + "/workspace/receipt.txt", "BRIDGE_NATIVE_OK");
const saved = JSON.parse(await fs.readFile("D:/Apps/TwoCode/data/model-connections.json", "utf8"));
const connections = new Map((await nativeConnections()).map((c) => [c.id, c]));
for (const c of saved.connections) connections.set(c.id, c);
await fs.writeFile(
  root + "/data/model-connections.json",
  JSON.stringify({
    revision: randomUUID(),
    connections: [...connections.values()].filter(
      (c) =>
        (c.harness === "pi" && c.provider === "ds-tencent") ||
        (c.harness === "step-code" && c.provider === "step-plan"),
    ),
    deleted: [],
  }),
  { mode: 0o600 },
);
process.env.TWO_CODE_HOME = root + "/data";
process.env.ZCODE_DATA_BASE_DIR = root + "/data";
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const task = await service.create({
  workspacePath: root + "/workspace",
  title: "本地交接传输真实验收",
  dual: true,
  mode: "yolo",
  lead: { harness: "pi", provider: "ds-tencent", model: "claude-sonnet-4-8", thinking: "high" },
  sidekick: {
    harness: "step-code",
    provider: "step-plan",
    model: "step-5-preview",
    thinking: "medium",
  },
});
console.log(JSON.stringify({ root }));
let result: unknown;
try {
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "主手只派唯一副手，用原生文件读取工具读取工作区相对路径receipt.txt一次，并逐字报告内容。不要用命令行、不联网、不写文件、不查目录。主手收到副手报告后用一句话回复内容，不需要自己重复读取。",
  });
  const end = Date.now() + 180000;
  let done = await service.read(task.id);
  while (done.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    done = await service.read(task.id);
  }
  assert.equal(done.status, "completed");
  assert.equal(done.events.filter((e) => e.kind === "handoff").length, 1);
  assert.equal(done.events.filter((e) => e.kind === "handoff_report").length, 1);
  assert.match(done.sidekick.lastReport ?? "", /BRIDGE_NATIVE_OK/);
  assert.match(done.lead.lastReport ?? "", /BRIDGE_NATIVE_OK/);
  assert(!done.events.some((e) => e.kind === "tool_end" && e.text === "error"));
  assert(
    !done.events.some((e) => e.kind === "tool" && /^(bash|powershell|run_command)$/i.test(e.text)),
  );
  assert.equal(await fs.readFile(root + "/workspace/receipt.txt", "utf8"), "BRIDGE_NATIVE_OK");
  assert.equal(done.permissions.length, 0);
  await fs.writeFile(
    root + "/native-model-evidence.json",
    JSON.stringify(await nativeModels(done), null, 2),
  );
  result = {
    passed: true,
    taskId: task.id,
    case: "pi-step-native-bridge",
    handoffs: 1,
    reports: 1,
    mode: done.mode,
  };
} catch (e) {
  result = { passed: false, error: String(e) };
  process.exitCode = 1;
} finally {
  if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
  await fs.writeFile(root + "/results.json", JSON.stringify(result, null, 2));
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    root + "/closed.json",
    JSON.stringify({ taskIds: [task.id], at: new Date().toISOString() }),
  );
  console.log(JSON.stringify(result));
}
