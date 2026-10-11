import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = process.env.TWO_CODE_ENVIRONMENT_ROOT?.replaceAll("\\", "/");
assert(root && /^D:\/Apps\/TwoCode\/qa\/environment-coding-\d+$/.test(root));
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const original = JSON.parse(await fs.readFile(`${root}/android-final.json`, "utf8"));
const ledgerBefore = await fs.readFile(`${root}/android/.qa/ledger.jsonl`, "utf8");
assert(
  JSON.parse(ledgerBefore.trim().split(/\r?\n/).at(-1)!).passed,
  "仅续接已有通过验证的Android任务",
);
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const denied = new Set<string>();
const sub = service.onDidChange((t) => {
  if (t.id === original.id)
    for (const p of t.permissions)
      if (!denied.has(p.id)) {
        denied.add(p.id);
        void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
      }
});
let result: Record<string, unknown> = { passed: false };
const started = Date.now();
try {
  await service.submit({
    taskId: original.id,
    requestId: randomUUID(),
    text: "上轮300秒验收截止已中断；原生PowerShell的PASS all和.qa/ledger.jsonl证实Android读写截屏已通过，不要重跑、改代码或重新截图。继续完成审查：主手先用原生task_create创建一项‘审查Android通过证据’，task_get核对该项，task_list查看清单；这些清单工具已适配无需授权。然后用唯一原副手核对device-result.json和screen.png，view_image实际看图，回传两句话结果；主手自己也view_image看screen.png，核对已有回执后用task_update把该项标为完成。最后两句话交付。所有图片和文件都在原工作区；只读与交接，不再执行shell。",
  });
  let done = await service.read(original.id);
  while (done.status === "running" && Date.now() - started < 300000) {
    await new Promise((r) => setTimeout(r, 400));
    done = await service.read(original.id);
  }
  assert.equal(done.status, "completed", done.error ?? "真实清单续接超过300秒");
  assert.equal(done.lead.sessionId, original.lead.sessionId);
  assert.equal(done.sidekick.sessionId, original.sidekick.sessionId);
  const events = done.events.filter((e) => e.seq > (original.events.at(-1)?.seq ?? 0));
  for (const tool of ["task_create", "task_get", "task_list", "task_update"]) {
    const calls = events.filter((e) => e.role === "lead" && e.kind === "tool" && e.text === tool);
    assert(
      calls.some((call) =>
        events.some(
          (e) => e.kind === "tool_end" && e.toolCallId === call.toolCallId && e.text === "success",
        ),
      ),
      `${tool}未真实成功`,
    );
  }
  for (const role of ["lead", "sidekick"])
    assert(
      events.some((e) => e.role === role && e.kind === "tool" && /view_image/.test(e.text)),
      `${role}未看图`,
    );
  assert(events.some((e) => e.kind === "handoff_report"));
  assert.equal(
    await fs.readFile(`${root}/android/.qa/ledger.jsonl`, "utf8"),
    ledgerBefore,
    "重复执行了已通过测试",
  );
  result = {
    passed: true,
    elapsedMs: Date.now() - started,
    taskId: original.id,
    sessionPreserved: true,
    repeatedVerification: false,
    deniedPermissions: denied.size,
    leadReport: done.lead.lastReport,
  };
} catch (e) {
  result = { ...result, error: String(e), elapsedMs: Date.now() - started };
  process.exitCode = 1;
} finally {
  if ((await service.read(original.id)).status === "running") await service.cancel(original.id);
  await fs.writeFile(
    `${root}/android-final.json`,
    JSON.stringify(await service.read(original.id), null, 2),
  );
  sub.dispose();
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(`${root}/android-resume.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
