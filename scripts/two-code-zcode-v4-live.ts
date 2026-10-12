import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { matrixEvidence } from "./two-code-four-harness-evidence.js";

const root = `D:/Apps/TwoCode/qa/zcode-v4-${Date.now()}`;
await fs.mkdir(root + "/data/.zcode/v2", { recursive: true });
await fs.writeFile(root + "/owner.json", JSON.stringify({ kind: "two-code-zcode-v4-qa", root }));
await fs.copyFile(
  "D:/Apps/TwoCode/data/.zcode/v2/provider_config.json",
  root + "/data/.zcode/v2/provider_config.json",
);
const configured = JSON.parse(
  await fs.readFile("D:/Apps/TwoCode/data/model-connections.json", "utf8"),
);
await fs.writeFile(
  root + "/data/model-connections.json",
  JSON.stringify({
    ...configured,
    connections: configured.connections.filter((c: any) => c.id === "native:pi:ds-tencent"),
    deleted: [],
  }),
  { mode: 0o600 },
);
process.env.TWO_CODE_HOME = root + "/data";
process.env.ZCODE_DATA_BASE_DIR = root + "/data";
process.env.ZCODE_HOME = root + "/data/.zcode";
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService, IZCodeAgentService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  zcodeAgentCommandResolver: () => ({
    command: process.execPath,
    args: [
      path.resolve("packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs"),
      "app-server",
      "--stdio",
    ],
    env: { ZCODE_HOME: process.env.ZCODE_HOME! },
  }),
});
const service = services.get(ITwoCodeService),
  agent = services.get(IZCodeAgentService);
const z = {
  harness: "zcode" as const,
  provider: "bigmodel-api",
  model: "GLM-5.3",
  thinking: "max",
};
const p = {
  harness: "pi" as const,
  provider: "ds-tencent",
  model: "claude-sonnet-4-8",
  thinking: "high",
};
const owned: string[] = [],
  results: any[] = [],
  native: Record<string, unknown> = {};
async function turn(id: string, text: string) {
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  const deadline = Date.now() + 240000;
  let t = await service.read(id);
  while (t.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    t = await service.read(id);
  }
  if (t.status === "running") t = await service.cancel(id);
  assert.equal(t.status, "completed", t.error ?? "本轮超时");
  return t;
}
async function run(zLead: boolean) {
  const name = zLead ? "zcode-lead" : "zcode-sidekick",
    cwd = root + "/" + name;
  await fs.mkdir(cwd);
  const task = await service.create({
    workspacePath: cwd,
    title: "ZCode修复验收-" + name,
    dual: true,
    mode: "yolo",
    lead: zLead ? z : p,
    sidekick: zLead ? p : z,
  });
  owned.push(task.id);
  const start = Date.now();
  try {
    const first = await turn(
      task.id,
      "这是两次交接验收：主手不得写文件或跑命令。第一步派唯一副手仅用文件工具创建note.txt，内容为ZCODE_V4_OK；收到报告后第二步再派同一个副手读取note.txt并报告内容，不要再次写入。两次交接必须分开，主手最后说明内容。全程不用shell、不联网、不装依赖，不操作其他文件。",
    );
    await fs.writeFile(root + "/" + name + "-first.json", JSON.stringify(first, null, 2));
    assert.equal(first.events.filter((e) => e.kind === "handoff").length, 2);
    assert.equal(first.events.filter((e) => e.kind === "handoff_report").length, 2);
    assert.equal((await fs.readFile(cwd + "/note.txt", "utf8")).trim(), "ZCODE_V4_OK");
    const second = await turn(
      task.id,
      "继续上一轮，沿用同一主副会话。只派唯一副手用文件工具读取note.txt并报告，主手确认当前内容与上一轮相同。不写文件、不跑命令、不联网，报告简短。",
    );
    for (const role of ["lead", "sidekick"] as const)
      assert.equal(second[role].sessionId, first[role].sessionId);
    const zRole = zLead ? "lead" : "sidekick";
    assert.equal(second[zRole].actualModel?.toLowerCase(), "glm-5.3");
    for (const kind of ["message", "reasoning", "tool", "tool_end"])
      assert(
        second.events.some((e) => e.role === zRole && e.kind === kind),
        `ZCode缺少${kind}`,
      );
    assert.equal(second.events.filter((e) => e.kind === "handoff_report").length, 3);
    assert.equal(second.permissions.length, 0);
    native[name] = await matrixEvidence(second, agent, root);
    results.push({
      name,
      passed: true,
      taskId: task.id,
      elapsedMs: Date.now() - start,
      sessionPreserved: true,
      threeHandoffs: true,
      liveProgress: true,
    });
  } catch (e) {
    results.push({ name, passed: false, taskId: task.id, error: String(e) });
  } finally {
    let t = await service.read(task.id);
    if (t.status === "running") t = await service.cancel(task.id);
    await fs.writeFile(root + "/" + name + "-final.json", JSON.stringify(t, null, 2));
    console.log(JSON.stringify(results.at(-1)));
  }
}
console.log(JSON.stringify({ root }));
try {
  await Promise.all([run(true), run(false)]);
} finally {
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(root + "/results.json", JSON.stringify(results, null, 2));
  await fs.writeFile(root + "/native-model-evidence.json", JSON.stringify(native, null, 2));
  await fs.writeFile(
    root + "/closed.json",
    JSON.stringify({ taskIds: owned, at: new Date().toISOString() }),
  );
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
