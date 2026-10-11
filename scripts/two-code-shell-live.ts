import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/shell-live-${Date.now()}`;
await fs.mkdir(path.join(root, "workspace"), { recursive: true });
process.env.TWO_CODE_HOME = path.join(root, "data");
process.env.ZCODE_DATA_BASE_DIR = path.join(root, "data");
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
let taskId: string | undefined;
const answered = new Set<string>();
const subscription = service.onDidChange((task) => {
  if (task.id !== taskId) return;
  for (const p of task.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      void service
        .respond({
          taskId: task.id,
          permissionId: p.id,
          allow: p.detail.includes("TWO_CODE_SHELL_AUDIT"),
        })
        .catch(() => {});
    }
});
try {
  const catalog = await service.catalog(),
    claude = catalog.find((h) => h.id === "claude-code")!.models[0]!,
    pi = catalog.find((h) => h.id === "pi")!.models.find((m) => m.provider === "ds-tencent")!;
  assert(pi);
  const task = await service.create({
    workspacePath: path.join(root, "workspace"),
    dual: true,
    mode: "build",
    lead: { harness: "claude-code", model: claude.id, provider: claude.provider },
    sidekick: { harness: "pi", model: pi.id, provider: pi.provider },
  });
  taskId = task.id;
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "所有输出中文。底座原生工具验收：主手自己通过原生PowerShell工具执行一次 $n=4; Write-Output ('TWO_CODE_SHELL_AUDIT_LEAD='+($n+1))。随后用sidekick让副手通过原生powershell工具执行一次 $n=8; Write-Output ('TWO_CODE_SHELL_AUDIT_SIDE='+($n+1))。两者都不要使用Bash/bash，不包powershell -Command，不读写文件，不重复执行。主手最后核对两个结果。",
  });
  const end = Date.now() + 150000;
  while (true) {
    const result = await service.read(task.id);
    if (result.status !== "running") {
      await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
      assert.equal(result.status, "completed", result.error);
      assert(
        result.events.some(
          (e) => e.role === "lead" && e.kind === "tool" && e.text === "PowerShell",
        ),
      );
      assert(
        result.events.some(
          (e) => e.role === "sidekick" && e.kind === "tool" && e.text === "powershell",
        ),
      );
      assert(!result.events.some((e) => e.kind === "tool" && e.text.toLowerCase() === "bash"));
      assert.match(result.lead.lastReport ?? "", /5/);
      assert.match(result.sidekick.lastReport ?? "", /9/);
      console.log(
        JSON.stringify({
          root,
          nativeClaude: true,
          nativePi: true,
          tools: result.events
            .filter((e) => e.kind === "tool")
            .map((e) => ({ role: e.role, tool: e.text })),
        }),
      );
      break;
    }
    if (Date.now() > end) {
      await service.cancel(task.id);
      throw Error("shell测试超时");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
} finally {
  subscription.dispose();
  if (taskId && (await service.read(taskId)).status === "running") await service.cancel(taskId);
  await disposeServiceResourcesAndWait(services);
}
