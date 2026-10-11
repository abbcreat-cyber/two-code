import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { configure } from "./two-code-glm-code-fixture.mjs";

const root = `D:/Apps/TwoCode/qa/glm-coordination-${Date.now()}`;
const windows = process.argv.includes("--windows");
await fs.mkdir(`${root}/data`, { recursive: true });
await fs.mkdir(`${root}/workspace`);
if (windows)
  await fs.writeFile(
    `${root}/workspace/check.mjs`,
    "import fs from 'node:fs';fs.writeFileSync(new URL('executed.txt',import.meta.url),'WINDOWS_NATIVE_OK');console.log('WINDOWS_NATIVE_OK');\n",
  );
await fs.writeFile(
  `${root}/owner.json`,
  JSON.stringify({ kind: "two-code-glm-coordination-qa", root }),
);
await configure(root);
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const task = await service.create({
  workspacePath: `${root}/workspace`,
  title: "Step原生退出码回执验收",
  dual: true,
  mode: "yolo",
  lead: {
    harness: "claude-code",
    provider: "bigmodel-coding-plan",
    model: "glm-5.3",
    thinking: "max",
  },
  sidekick: {
    harness: "step-code",
    provider: "step-plan",
    model: "step-5-preview",
    thinking: "medium",
  },
});
let result: Record<string, unknown>;
console.log(JSON.stringify({ root }));
try {
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: windows
      ? `Windows路径验收：主手派唯一副手，执行且仅执行一次命令 node '${root}/workspace/check.mjs'。自行选择本机正确的原生命令工具，不修改check.mjs，不联网，不安装依赖。该固定脚本会创建executed.txt。主手读取真实回执后简短报告，不重复执行。`
      : '这是一次明确的原生命令失败回执验收：主手派唯一副手，只用Step原生run_command执行一次 command 为 node -e "process.exit(7)" 。本次明确要求run_command，不用powershell替代，以验证该工具的退出码格式。预期失败且退出码7，这是成功的测试，不重跑、不修复、不读写文件、不联网。副手报告真实输出；主手读取回执后简短报告。',
  });
  const end = Date.now() + 180000;
  let done = await service.read(task.id);
  while (done.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    done = await service.read(task.id);
  }
  assert.equal(done.status, "completed", done.error ?? "验收超时");
  const receipts = done.events
    .filter((e) => e.role === "sidekick" && e.kind === "verification")
    .map((e) => JSON.parse(e.text))
    .filter((r) => r.status !== "not-executed");
  assert.equal(receipts.length, 1);
  if (windows) {
    assert.equal(receipts[0].tool, "powershell");
    assert.equal(receipts[0].status, "completed");
    assert.equal(await fs.readFile(`${root}/workspace/executed.txt`, "utf8"), "WINDOWS_NATIVE_OK");
  } else {
    assert.equal(receipts[0].tool, "run_command");
    assert.equal(receipts[0].status, "failed");
    assert.equal(receipts[0].reportedExitCode, 7);
    const native = await fs.readFile(done.sidekick.sessionId!, "utf8");
    assert(native.includes("Command exited with code 7"));
  }
  result = {
    passed: true,
    case: windows ? "windows-path" : "exit-code",
    taskId: task.id,
    receipts,
    mode: done.mode,
  };
} catch (error) {
  result = { passed: false, error: String(error) };
  process.exitCode = 1;
} finally {
  if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(result!, null, 2));
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ at: new Date().toISOString(), taskIds: [task.id] }),
  );
  console.log(JSON.stringify(result!));
}
