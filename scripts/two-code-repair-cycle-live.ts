import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verificationReport } from "../packages/services/src/two-code/domain/verification-report.js";
const root = `D:/Apps/TwoCode/qa/repair-cycle-${Date.now()}`,
  cwd = `${root}/workspace`;
await fs.mkdir(cwd, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const command = `node '${cwd}/check.mjs'`;
const check =
  "import fs from 'node:fs';import {add} from './math.mjs';fs.appendFileSync(new URL('runs.log',import.meta.url),'run\\n');if(add(2,3)!==5){console.log('FAIL: OLD: expected 5');process.exit(7);}console.log('PASS: REPAIRED: result 5');\n";
await fs.writeFile(`${cwd}/check.mjs`, check);
await fs.writeFile(`${cwd}/math.mjs`, "export const add = (a,b) => a-b;\n");
let id: string | undefined,
  allowCommand = true;
const answered = new Set<string>(),
  checks: string[] = [];
const sub = service.onDidChange((t) => {
  if (t.id !== id) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      let allow = false;
      try {
        allow =
          allowCommand &&
          p.role === "sidekick" &&
          p.title === "PowerShell" &&
          JSON.parse(p.detail).command === command;
      } catch {
        /* 非本轮原生命令一律拒绝。 */
      }
      void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
    }
});
async function turn(text: string, label: string) {
  await service.submit({ taskId: id!, requestId: randomUUID(), text });
  const end = Date.now() + 150000;
  let t = await service.read(id!);
  while (t.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    t = await service.read(id!);
  }
  await fs.writeFile(`${root}/${label}.json`, JSON.stringify(t, null, 2));
  assert.equal(t.status, "completed", t.error || `${label}超时`);
  assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
  assert.equal(t.permissions.length, 0);
  return t;
}
let passed = false;
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  const task = await service.create({
    workspacePath: cwd,
    dual: true,
    mode: "edit",
    lead: {
      harness: "step-code",
      provider: "step-plan",
      model: "step-5-preview",
      thinking: "medium",
    },
    sidekick: {
      harness: "claude-code",
      provider: model.provider,
      model: model.id,
      thinking: "high",
    },
  });
  id = task.id;
  console.log(JSON.stringify({ root, id }));
  const limit = `只操作当前工作区${cwd}，不联网、不用技能。不得修改check.mjs和runs.log。`;
  const first = await turn(
    `${limit}第一轮只验证，不修复。让副手用原生PowerShell逐字执行以下命令一次，不添加或删改任何字符；主手读取副手报告，如实说明失败及退出码，不重跑、不修复。\n${command}`,
    "first-failed",
  );
  assert.equal(await fs.readFile(`${cwd}/runs.log`, "utf8"), "run\n");
  assert.match(verificationReport(first), /FAIL: OLD/);
  assert.match(verificationReport(first), /"reportedExitCode":7/);
  checks.push("failure-receipt-returned");
  const second = await turn(
    `${limit}现在让同一副手修复math.mjs的add(a,b)，应返回a+b。只改math.mjs；修复后仍用原生PowerShell逐字运行以下命令一次，不增删字符。主手读代码与副手报告核对，不重跑测试。\n${command}`,
    "second-repaired",
  );
  assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
  assert.equal(second.lead.sessionId, first.lead.sessionId);
  assert.equal(await fs.readFile(`${cwd}/runs.log`, "utf8"), "run\nrun\n");
  const report = verificationReport(second);
  assert.match(report, /PASS: REPAIRED/);
  assert(!report.includes("FAIL: OLD"));
  checks.push("same-sidekick-repair-current-receipt-only");
  allowCommand = false;
  const third = await turn(
    `${limit}上一轮验证已经通过，禁止再次执行任何命令或修改文件。让原副手调用read_handoff_history查询已有原生执行证据，报告最近一次验证的标记和退出码；主手依据报告简短转述。`,
    "third-recalled",
  );
  assert.equal(third.sidekick.sessionId, first.sidekick.sessionId);
  assert.equal(await fs.readFile(`${cwd}/runs.log`, "utf8"), "run\nrun\n");
  assert.equal(verificationReport(third), "");
  assert.match(third.lead.lastReport!, /PASS: REPAIRED/);
  assert(
    third.events.some(
      (e) =>
        e.seq > second.events.at(-1)!.seq &&
        e.role === "sidekick" &&
        e.kind === "tool" &&
        e.text.endsWith("read_handoff_history"),
    ),
  );
  checks.push("history-recall-without-rerun");
  passed = true;
} finally {
  sub.dispose();
  if (id && (await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ root, passed, checks }, null, 2));
  console.log(JSON.stringify({ root, passed, checks }));
  await disposeServiceResourcesAndWait(services);
  if (!passed) process.exitCode = 1;
}
