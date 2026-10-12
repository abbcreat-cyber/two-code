import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nativeConnections } from "../packages/services/src/two-code/adapters/native-connections.js";
import { nativeModels } from "./two-code-role-swap-metrics.js";

const resume = process.argv.find((a) => a.startsWith("--resume="))?.slice(9);
const root = resume
  ? path.resolve(resume).replaceAll("\\", "/")
  : `D:/Apps/TwoCode/qa/glm-coordination-${Date.now()}`;
assert(/^D:\/Apps\/TwoCode\/qa\/glm-coordination-\d+$/.test(root));
let priorTaskId: string | undefined;
if (resume) {
  const owner = JSON.parse(await fs.readFile(root + "/owner.json", "utf8"));
  assert.equal(owner.kind, "two-code-glm-coordination-qa");
  assert.equal(path.resolve(owner.root), path.resolve(root));
  priorTaskId = JSON.parse(await fs.readFile(root + "/closed.json", "utf8")).taskIds[0];
} else {
  await fs.mkdir(root + "/data", { recursive: true });
  await fs.mkdir(root + "/workspace with space");
  await fs.writeFile(
    root + "/owner.json",
    JSON.stringify({ kind: "two-code-glm-coordination-qa", root }),
  );
}
const failureLine = "FAIL: native-long-receipt-" + "x".repeat(240);
const fixture = `console.error(${JSON.stringify(failureLine)});process.exit(7);\n`;
if (!resume) {
  await fs.writeFile(root + "/workspace with space/check.mjs", fixture);
  const saved = JSON.parse(
    await fs.readFile("D:/Apps/TwoCode/data/model-connections.json", "utf8"),
  );
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
}
process.env.TWO_CODE_HOME = root + "/data";
process.env.ZCODE_DATA_BASE_DIR = root + "/data";
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const task = priorTaskId
  ? await service.read(priorTaskId)
  : await service.create({
      workspacePath: root + "/workspace with space",
      title: "遗留协作问题真实验收",
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
console.log(JSON.stringify({ root, taskId: task.id }));
const results: unknown[] = [];
async function turn(name: string, text: string) {
  await service.submit({ taskId: task.id, requestId: randomUUID(), text });
  const end = Date.now() + 180000;
  let t = await service.read(task.id);
  while (t.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    t = await service.read(task.id);
  }
  await fs.writeFile(root + "/" + name + ".json", JSON.stringify(t, null, 2));
  assert.equal(t.status, "completed", t.error ?? "本轮超时");
  assert.equal(t.permissions.length, 0);
  return t;
}
try {
  const first: Awaited<ReturnType<typeof service.read>> = resume
    ? JSON.parse(await fs.readFile(root + "/long-failure.json", "utf8"))
    : await turn(
        "long-failure",
        "这是一次预期失败的回执验收。主手派唯一副手，仅用原生powershell工具在当前工作区执行且只执行一次命令：node check.mjs; exit $LASTEXITCODE。脚本故意输出很长的FAIL行并退出7，属于验收预期；不要修复、重试、添加其他命令、读写文件或联网。副手报告实际失败，主手根据原生回执简短说明结果。",
      );
  const receipts = first.events
    .filter((e) => e.kind === "verification" && e.role === "sidekick")
    .map((e) => JSON.parse(e.text))
    .filter((r) => r.status !== "not-executed");
  const requested = receipts.filter((r) => r.tool === "powershell");
  assert.equal(requested.length, 1);
  assert.equal(requested[0].status, "failed");
  assert.equal(requested[0].reportedExitCode, 7);
  assert(
    requested[0].summaries.some(
      (s: string) =>
        s.startsWith("FAIL: native-long-receipt-") && s.length === 180 && s.endsWith("…"),
    ),
  );
  assert.equal(await fs.readFile(root + "/workspace with space/check.mjs", "utf8"), fixture);
  results.push({
    case: "long-failure-receipt",
    passed: true,
    receipts,
    singleCommandRequirementPassed: receipts.length === 1,
    extraNativeCommands: receipts.length - 1,
  });
  console.log(JSON.stringify(results.at(-1)));
  const seq = first.events.at(-1)!.seq;
  const second = await turn(
    "history-read",
    "本轮不要派工，不运行命令，不读写文件。先调用read_sidekick读取当前状态，再用read_handoff_history读取上一轮已经保存的回执，说明上一轮是什么失败。明确这是历史记录，不是本轮新执行。",
  );
  const events = second.events.filter((e) => e.seq > seq);
  assert.equal(
    events.filter(
      (e) => e.kind === "handoff" || e.kind === "handoff_report" || e.kind === "verification",
    ).length,
    0,
  );
  assert(events.some((e) => e.kind === "tool" && e.text === "read_sidekick"));
  assert(events.some((e) => e.kind === "tool" && e.text === "read_handoff_history"));
  assert(!events.some((e) => e.kind === "tool_end" && e.text === "error"));
  assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
  results.push({ case: "history-read", passed: true, noRedispatch: true });
  console.log(JSON.stringify(results.at(-1)));
  const third = await turn(
    "git-bash",
    "这是原生Bash环境验收。主手派同一副手，只用Step原生run_command执行一次 uname -s，并逐字报告输出。不要用powershell替代，不额外探测，不读写文件，不联网，不安装依赖。主手收到报告后简短回复。",
  );
  assert.equal(third.sidekick.sessionId, first.sidekick.sessionId);
  const native = await fs.readFile(third.sidekick.sessionId!, "utf8");
  const outputs = native
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s))
    .filter((r) => r.message?.role === "toolResult" && r.message?.toolName === "run_command");
  assert(
    outputs.some((r) => !r.message.isError && JSON.stringify(r.message.content).includes("MINGW")),
  );
  const later = third.events
    .filter(
      (e) =>
        e.seq > second.events.at(-1)!.seq && e.role === "sidekick" && e.kind === "verification",
    )
    .map((e) => JSON.parse(e.text))
    .filter((r) => r.status !== "not-executed");
  assert.equal(later.length, 1);
  assert.equal(later[0].tool, "run_command");
  assert.equal(later[0].status, "completed");
  results.push({ case: "git-bash", passed: true, sessionPreserved: true });
  console.log(JSON.stringify(results.at(-1)));
  await fs.writeFile(
    root + "/native-model-evidence.json",
    JSON.stringify(await nativeModels(third), null, 2),
  );
} catch (error) {
  results.push({ passed: false, error: String(error) });
  console.log(JSON.stringify(results.at(-1)));
  process.exitCode = 1;
} finally {
  if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
  await fs.writeFile(
    root + (resume ? "/followup-results.json" : "/results.json"),
    JSON.stringify(results, null, 2),
  );
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    root + "/closed.json",
    JSON.stringify({ taskIds: [task.id], at: new Date().toISOString() }),
  );
}
