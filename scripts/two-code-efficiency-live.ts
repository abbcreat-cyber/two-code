import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const label = process.env.TWO_CODE_BENCH_LABEL || "baseline";
const root = `D:/Apps/TwoCode/qa/efficiency-${label}-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const owned = new Map<string, string>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const subscription = service.onDidChange((t) => {
  const cwd = owned.get(t.id);
  if (!cwd) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    const allow =
      p.role === "sidekick" &&
      p.title === "PowerShell" &&
      p.detail.replaceAll("\\\\", "/").includes(`${cwd}/check.mjs`);
    void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function settled(id: string) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("任务超时");
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, label }));
  let sample = 0;
  for (const name of ["frozen", "repair", "visual", "failure"]
    .filter(
      (n) =>
        !process.env.TWO_CODE_BENCH_CASES ||
        process.env.TWO_CODE_BENCH_CASES.split(",").includes(n),
    )
    .flatMap((name) =>
      Array.from(
        { length: Math.max(1, Math.min(3, Number(process.env.TWO_CODE_BENCH_REPEATS) || 1)) },
        () => name,
      ),
    )) {
    sample++;
    const cwd = `${root}/${name}-${sample}`;
    await fs.mkdir(cwd, { recursive: true });
    const task = await service.create({
      workspacePath: cwd,
      mode: "edit",
      dual: true,
      lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
      sidekick: {
        harness: "claude-code",
        provider: model.provider,
        model: model.id,
        thinking: "high",
      },
    });
    owned.set(task.id, cwd);
    let prompt = "";
    if (name === "frozen") {
      await fs.writeFile(`${cwd}/totals.json`, '{"count":5,"total":37.25}');
      prompt =
        "让副手把已核实的totals.json呈现为result.md，两行分别是笔数和总金额；数值直接沿用，不重新计算。主手读取产物核对。只用文件工具，不执行命令，不联网。";
    } else if (name === "repair") {
      await fs.writeFile(
        `${cwd}/sum.mjs`,
        "export function sumPaid(items) { return items.reduce((s,x)=>s+x.amount,0); }\n",
      );
      await fs.writeFile(
        `${cwd}/check.mjs`,
        "import assert from 'node:assert/strict';import {sumPaid} from './sum.mjs';assert.equal(sumPaid([]),0);assert.equal(sumPaid([{status:'paid',amount:'0.10'},{status:'paid',amount:'0.20'},{status:'cancelled',amount:'9.00'}]),0.3);assert.equal(sumPaid([{status:'paid',amount:'-2.50'},{status:'paid',amount:5}]),2.5);console.log('3 checks passed');\n",
      );
      prompt = `让副手修复sum.mjs：只统计status为paid的金额，amount兼容数字和字符串，按整数分累加避免浮点误差，空数组返回0，允许负金额。不得改check.mjs。副手完成后用原生PowerShell运行一次 node '${cwd}/check.mjs'；主手读修改代码审查，不重复运行测试。只操作当前目录，不联网。`;
    } else if (name === "failure") {
      await fs.writeFile(
        `${cwd}/check.mjs`,
        "console.log('FAIL: intentional fixture');process.exitCode=7;\n",
      );
      prompt = `让副手用原生PowerShell只运行一次 node '${cwd}/check.mjs'，随后输出EXITCODE并把Node退出码传给PowerShell退出码。这个脚本是预期失败的验收夹具，不改文件、不重试、不修复。主手据原生回执说明该次执行是否失败，不额外执行任何命令，不联网。`;
    } else {
      await fs.writeFile(
        `${cwd}/card.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="white"/><circle cx="55" cy="90" r="30" fill="blue"/><circle cx="300" cy="90" r="35" fill="red"/><text x="105" y="100" font-size="20">HELLO</text></svg>',
      );
      prompt =
        "card.svg右边的红圆被画布截断。让副手最小修改使红圆完整位于画面中，保留蓝圆和HELLO文字，三个元素互不重叠。副手用Read/Edit或Write修改即可，主手用view_image独立看图验收。禁止命令和联网。";
    }
    const protectedCheck =
      name === "repair" ? await fs.readFile(`${cwd}/check.mjs`, "utf8") : undefined;
    const start = Date.now();
    try {
      await service.submit({ taskId: task.id, requestId: randomUUID(), text: prompt });
      const done = await settled(task.id);
      const elapsedMs = Date.now() - start;
      assert.equal(done.status, "completed", done.error);
      if (name === "failure") {
        const receipts = done.events
          .filter((e) => e.role === "sidekick" && e.kind === "verification")
          .map((e) => JSON.parse(e.text));
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].status, "failed");
        assert.match(done.lead.lastReport!, /失败|非零/);
        assert.match(done.lead.lastReport!, /7/);
        assert.equal(
          await fs.readFile(`${cwd}/check.mjs`, "utf8"),
          "console.log('FAIL: intentional fixture');process.exitCode=7;\n",
        );
      }
      if (name === "frozen") {
        const s = await fs.readFile(`${cwd}/result.md`, "utf8");
        assert.match(s, /5/);
        assert.match(s, /37\.25/);
      }
      if (name === "repair") {
        const { sumPaid } = await import(pathToFileURL(`${cwd}/sum.mjs`).href);
        assert.equal(sumPaid([]), 0);
        assert.equal(
          sumPaid([
            { status: "paid", amount: "0.10" },
            { status: "paid", amount: "0.20" },
            { status: "cancelled", amount: 9 },
          ]),
          0.3,
        );
        assert.equal(
          sumPaid([
            { status: "paid", amount: -2.5 },
            { status: "paid", amount: "5" },
          ]),
          2.5,
        );
        assert.equal(sumPaid([{ status: "pending", amount: 10 }]), 0);
        assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), protectedCheck);
      }
      if (name === "visual") {
        const svg = await fs.readFile(`${cwd}/card.svg`, "utf8");
        const circles = [...svg.matchAll(/<circle\b[^>]*>/g)].map((m) =>
          Object.fromEntries(
            [...m[0].matchAll(/(\w+)=["']([^"']*)["']/g)].map((x) => [x[1], x[2]]),
          ),
        );
        assert.equal(circles.length, 2);
        const red = circles.find((c) => c.fill === "red" || c.fill === "#ff0000");
        assert(red);
        assert(Number(red.cx) + Number(red.r) <= 320);
        assert(Number(red.cx) - Number(red.r) >= 0);
        assert.match(svg, /HELLO/);
        assert(
          done.events.some(
            (e) => e.role === "lead" && e.kind === "tool" && e.text === "view_image",
          ),
        );
      }
      const tokens = (done.usage ?? []).reduce((s, u) => s + u.outputTokens, 0);
      results.push({
        name,
        sample,
        taskId: task.id,
        passed: true,
        elapsedMs,
        outputTokens: tokens,
        handoffs: done.events.filter((e) => e.kind === "handoff").length,
        tools: done.events
          .filter((e) => e.kind === "tool" && !e.notExecuted)
          .map((e) => `${e.role}:${e.text}`),
        reportChars: (done.lead.lastReport?.length ?? 0) + (done.sidekick.lastReport?.length ?? 0),
        nativeReceipts: done.events
          .filter((e) => e.role === "sidekick" && e.kind === "verification")
          .map((e) => JSON.parse(e.text)),
      });
    } catch (error) {
      results.push({
        name,
        sample,
        taskId: task.id,
        passed: false,
        elapsedMs: Date.now() - start,
        error: String(error),
      });
    } finally {
      await fs.writeFile(
        `${root}/${name}-${sample}.json`,
        JSON.stringify(await service.read(task.id), null, 2),
      );
      if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally {
  subscription.dispose();
  for (const id of owned.keys())
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
