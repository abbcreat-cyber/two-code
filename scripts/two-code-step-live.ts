import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const root = `D:/Apps/TwoCode/qa/step-${Date.now()}`;
await fs.mkdir(path.join(root, "workspace"), { recursive: true });
process.env.TWO_CODE_HOME = path.join(root, "data");
process.env.ZCODE_DATA_BASE_DIR = path.join(root, "data");
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const approvals = new Set<string>();
let taskId: string | undefined;
const subscription = service.onDidChange((task) => {
  if (task.id !== taskId) return;
  for (const p of task.permissions)
    if (!approvals.has(p.id)) {
      approvals.add(p.id);
      void service
        .respond({
          taskId: task.id,
          permissionId: p.id,
          allow: p.detail.includes("TWO_CODE_NATIVE_PS"),
        })
        .catch(() => {});
    }
});
async function settle(id: string) {
  const deadline = Date.now() + 150000;
  while (true) {
    const value = await service.read(id);
    if (value.status !== "running") return value;
    if (Date.now() > deadline) {
      await service.cancel(id);
      throw Error("Step测试超过150秒");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
try {
  const catalog = await service.catalog();
  const step = catalog.find((c) => c.id === "step-code");
  assert(step?.available);
  assert.deepEqual(
    step.models.map((m) => m.name),
    ["Step-5 API", "Step-5 订阅"],
  );
  const selection = {
    harness: "step-code" as const,
    provider: "step-plan",
    model: "step-5-preview",
  };
  const task = await service.create({
    workspacePath: path.join(root, "workspace"),
    dual: true,
    mode: "build",
    lead: selection,
    sidekick: selection,
  });
  taskId = task.id;
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "所有输出中文。Two Code底座验收：必须用sidekick让副手通过原生powershell工具执行一次下面这段只读脚本，不经过bash或run_command，不套powershell -Command：$n = 7; Write-Output ('TWO_CODE_NATIVE_PS=' + ($n + 1)); Write-Output '中文 $ & 空格'。副手如实报告输出，主手拿到报告后核对并简短结束。不要重复执行，不读写其他文件。",
  });
  const first = await settle(task.id);
  await fs.writeFile(path.join(root, "first.json"), JSON.stringify(first, null, 2));
  assert.equal(first.status, "completed", first.error);
  assert(
    first.events.some((e) => e.role === "sidekick" && e.kind === "tool" && e.text === "powershell"),
  );
  assert(
    !first.events.some(
      (e) => e.role === "sidekick" && e.kind === "tool" && /bash|run_command/i.test(e.text),
    ),
  );
  assert.match(first.sidekick.lastReport ?? "", /TWO_CODE_NATIVE_PS=8/);
  assert.match(first.sidekick.lastReport ?? "", /中文 \$ & 空格/);
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "继续复用原副手，不使用powershell或任何文件/执行工具。让原副手仅凭自己的历史回复上次打印的数字标记行；主手简短核对即可。",
  });
  const second = await settle(task.id);
  await fs.writeFile(path.join(root, "second.json"), JSON.stringify(second, null, 2));
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
  assert.match(second.sidekick.lastReport ?? "", /TWO_CODE_NATIVE_PS=8/);
  console.log(
    JSON.stringify({
      root,
      taskId: task.id,
      channels: step.models,
      lead: first.lead.actualModel,
      sidekick: first.sidekick.actualModel,
      sameSidekick: true,
      nativePowerShell: true,
    }),
  );
} finally {
  subscription.dispose();
  if (taskId && (await service.read(taskId)).status === "running") await service.cancel(taskId);
  await disposeServiceResourcesAndWait(services);
}
