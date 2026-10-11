import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readLedger, stageMetrics, artifacts } from "./two-code-role-swap-metrics.js";
import type { TwoCodeTask } from "../packages/services/src/two-code/contract.js";

const root = path.resolve(process.argv[2] ?? "");
assert(/^D:\\Apps\\TwoCode\\qa\\role-swap-\d+$/.test(root));
const closed = JSON.parse(await fs.readFile(`${root}/closed.json`, "utf8"));
const data = JSON.parse(await fs.readFile(`${root}/results.json`, "utf8"));
await fs.copyFile(`${root}/results.json`, `${root}/initial-results.json`);
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
// 可指定比较开始时的已构建基线，避免将随后修复混入续接的测量。
const builtBaseline = process.env.TWO_CODE_BENCH_BUILT === "1";
const { createLocalServices, disposeServiceResourcesAndWait } = builtBaseline
  ? await import("../packages/services/dist/node.js")
  : await import("../packages/services/src/node.js");
const { ITwoCodeService } = builtBaseline
  ? await import("../packages/services/dist/index.js")
  : await import("../packages/services/src/index.js");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
});
const service = services.get(ITwoCodeService);
const continuations: unknown[] = [];
await fs.unlink(`${root}/closed.json`);
try {
  for (const result of data.results) {
    if (result.passed || !String(result.error).includes("300秒超时")) continue;
    const before = await service.read(result.taskId);
    const expected = result.size === "long" ? ["core", "storage", "expiry", "all"] : ["all"];
    const ledger = await readLedger(before.workspacePath);
    if (!expected.every((p) => ledger.some((r) => r.phase === p && r.passed))) continue;
    assert.equal(before.mode, "yolo");
    result.initialOutcome = {
      passed: result.passed,
      error: result.error,
      elapsedMs: result.elapsedMs,
      status: result.finalStatus,
    };
    const started = Date.now();
    const detail: Record<string, unknown> = {
      label: result.label,
      originalElapsedMs: result.elapsedMs,
    };
    try {
      await service.submit({
        taskId: before.id,
        requestId: randomUUID(),
        text: "继续完成上一轮未结束的主手复核和最终交付，沿用原主副手分工与验收条件。先核对已有副手报告、原生回执与关键产物；输入和代码没变且已通过的测试不要重跑。发现具体真实问题才交给原副手修复并重新验证。不要因上轮中断而重做整个任务。",
      });
      let done: TwoCodeTask = await service.read(before.id);
      while (done.status === "running" && Date.now() - started < 300000) {
        await new Promise((r) => setTimeout(r, 250));
        done = await service.read(before.id);
      }
      assert.equal(done.status, "completed", done.error ?? "续接仍超过300秒");
      assert.deepEqual(
        [done.lead.sessionId, done.sidekick.sessionId],
        [before.lead.sessionId, before.sidekick.sessionId],
      );
      const current = await readLedger(before.workspacePath);
      assert(expected.every((p) => current.some((r) => r.phase === p && r.passed)));
      const files = (await fs.readdir(`${before.workspacePath}/src`))
        .filter((n) => n.endsWith(".mjs"))
        .sort();
      const source = await Promise.all(
        files.map(async (n) => [n, await fs.readFile(`${before.workspacePath}/src/${n}`, "utf8")]),
      );
      assert.equal(
        createHash("sha256").update(JSON.stringify(source)).digest("hex"),
        current.at(-1)!.hash,
        "续接修改源码后必须重新验证",
      );
      Object.assign(result, stageMetrics(done, 0, current), {
        passed: true,
        error: undefined,
        finalStatus: done.status,
        usage: done.usage,
      });
      detail.passed = true;
      detail.sameSessions = true;
      detail.extraValidationRuns = current.length - ledger.length;
    } catch (error) {
      result.error = String(error);
      detail.passed = false;
      detail.error = String(error);
    } finally {
      if ((await service.read(before.id)).status === "running") await service.cancel(before.id);
      detail.elapsedMs = Date.now() - started;
      result.elapsedMs += detail.elapsedMs;
      result.externalContinuations = 1;
      result.continuation = detail;
      continuations.push(detail);
      const final = await service.read(before.id);
      await fs.writeFile(`${root}/${result.label}-final.json`, JSON.stringify(final, null, 2));
      const outputs = JSON.parse(await fs.readFile(`${root}/artifacts.json`, "utf8"));
      outputs[result.label] = await artifacts(before.workspacePath);
      await fs.writeFile(`${root}/artifacts.json`, JSON.stringify(outputs, null, 2));
      console.log(JSON.stringify(detail));
    }
  }
} finally {
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(data, null, 2));
  await fs.writeFile(`${root}/continuations.json`, JSON.stringify(continuations, null, 2));
  await fs.writeFile(
    `${root}/closed.json`,
    JSON.stringify({ ...closed, at: new Date().toISOString() }),
  );
}
