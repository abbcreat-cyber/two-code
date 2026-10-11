import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handoffHistory } from "../packages/services/src/two-code/domain/handoffs.js";

const label = process.env.TWO_CODE_HISTORY_LABEL || "baseline";
const root = `D:/Apps/TwoCode/qa/history-${label}-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const owned = new Map<string, string>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((task) => {
  const command = owned.get(task.id);
  if (!command) return;
  for (const p of task.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    let allow = false;
    try {
      allow =
        p.role === "sidekick" &&
        p.title === "PowerShell" &&
        JSON.parse(p.detail).command === command;
    } catch {
      /* Malformed permission details are denied. */
    }
    void service.respond({ taskId: task.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function turn(id: string, text: string, name: string) {
  const start = Date.now();
  await service.submit({ taskId: id, requestId: randomUUID(), text });
  while (Date.now() - start < 180000) {
    const task = await service.read(id);
    if (task.status !== "running") {
      await fs.writeFile(`${root}/${name}.json`, JSON.stringify(task, null, 2));
      assert.equal(task.status, "completed", task.error);
      return { task, elapsedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("任务超时");
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, label, sidekickModel: model.id, realModel: model.realModel }));
  for (const name of ["success", "failure"]) {
    const cwd = `${root}/${name}`;
    await fs.mkdir(cwd, { recursive: true });
    const failed = name === "failure";
    const fixture = `import fs from 'node:fs';fs.appendFileSync(new URL('runs.txt',import.meta.url),'once\\n');console.log('${failed ? "FAIL: fixture" : "3 checks passed"}');process.exitCode=${failed ? 7 : 0};\n`;
    await fs.writeFile(`${cwd}/check.mjs`, fixture);
    const command = `node '${cwd}/check.mjs'; $code = $LASTEXITCODE; Write-Output "EXITCODE=$code"; exit $code`;
    const task = await service.create({
      workspacePath: cwd,
      dual: true,
      mode: "edit",
      lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
      sidekick: {
        harness: "claude-code",
        provider: model.provider,
        model: model.id,
        thinking: "high",
      },
    });
    owned.set(task.id, command);
    try {
      const first = await turn(
        task.id,
        `让副手用原生PowerShell精确执行下面命令一次，不增减字符。它是验收夹具，预期${failed ? "失败退出7" : "通过"}。禁止修改或读取文件、禁止重试、禁止其他命令或联网。副手完成后主手直接简短报告结果。\n${command}`,
        `${name}-first`,
      );
      const receipt = first.task.events.find(
        (e) => e.role === "sidekick" && e.kind === "verification",
      );
      assert(receipt, "没有原生回执");
      assert.equal(JSON.parse(receipt.text).status, failed ? "failed" : "completed");
      const page = JSON.parse(handoffHistory(first.task));
      const ledger = JSON.parse(page.text);
      const historyHasReceipt = ledger.some((e: { kind: string }) => e.kind === "verification");
      await fs.writeFile(`${root}/${name}-history.json`, JSON.stringify(ledger, null, 2));
      const lastSeq = first.task.events.at(-1)!.seq;
      const second = await turn(
        task.id,
        "现在只整理上一轮结果，不重新执行。主手先read_handoff_history；让原副手也read_handoff_history并只用Write写receipt.md。内容须区分原生verification回执与副手自述：历史没有原生回执就明确写缺失，不把自述冒充回执；有则列出原始seq、toolCallId、status、reportedExitCode和summaries。主手读取receipt.md核对后简短交付。禁止任何命令、其他文件或联网。",
        `${name}-followup`,
      );
      const content = await fs.readFile(`${cwd}/receipt.md`, "utf8");
      const followup = second.task.events.filter((e) => e.seq > lastSeq);
      const historyReads = followup.filter(
        (e) => e.kind === "tool" && e.text.endsWith("read_handoff_history"),
      );
      assert(historyReads.some((e) => e.role === "lead"));
      assert(historyReads.some((e) => e.role === "sidekick"));
      assert.equal(second.task.sidekick.sessionId, first.task.sidekick.sessionId);
      assert(!followup.some((e) => e.kind === "verification"), "补充请求重复执行命令");
      assert.equal(await fs.readFile(`${cwd}/runs.txt`, "utf8"), "once\n");
      assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), fixture);
      if (historyHasReceipt) {
        assert(content.includes(receipt.toolCallId!), "产物遗漏真实toolCallId");
        assert(content.includes(failed ? "failed" : "completed"));
        assert(content.includes(String(failed ? 7 : 0)));
      } else {
        assert.match(content, /缺失|不存在|没有|未.*(?:提供|包含|记录)/);
      }
      results.push({
        name,
        passed: true,
        historyHasReceipt,
        taskId: task.id,
        firstMs: first.elapsedMs,
        followupMs: second.elapsedMs,
        outputTokens: (second.task.usage ?? []).reduce((n, u) => n + u.outputTokens, 0),
        tools: followup.filter((e) => e.kind === "tool").map((e) => `${e.role}:${e.text}`),
        report: content,
      });
    } catch (error) {
      results.push({ name, passed: false, taskId: task.id, error: String(error) });
    } finally {
      await fs.writeFile(
        `${root}/${name}-final.json`,
        JSON.stringify(await service.read(task.id), null, 2),
      );
      if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally {
  sub.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
