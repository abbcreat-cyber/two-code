import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = `D:/Apps/TwoCode/qa/variety-${process.env.TWO_CODE_VARIETY_LABEL || "baseline"}-${Date.now()}`;
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
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id)) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    let allow = false;
    try {
      allow =
        p.role === "sidekick" &&
        p.title === "PowerShell" &&
        JSON.parse(p.detail).command === owned.get(t.id);
    } catch {
      /* Deny malformed requests. */
    }
    void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function until<T>(read: () => Promise<T | false>, timeout = 180000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value !== false) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("验收超时");
}
const settle = (id: string) =>
  until(async () => {
    const t = await service.read(id);
    return t.status === "running" ? false : t;
  });
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  console.log(JSON.stringify({ root, realModel: model.realModel }));
  for (const name of ["data", "multi", "revise", "draw", "draw-sidekick"].filter(
    (n) =>
      !process.env.TWO_CODE_VARIETY_CASES ||
      process.env.TWO_CODE_VARIETY_CASES.split(",").includes(n),
  )) {
    const cwd = `${root}/${name} 中文 空格`;
    await fs.mkdir(cwd, { recursive: true });
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
    const command = `node '${cwd}/check.mjs'; $code = $LASTEXITCODE; Write-Output "EXITCODE=$code"; exit $code`;
    owned.set(task.id, name === "multi" ? command : "");
    let prompt = "",
      check: string | undefined;
    if (name === "data") {
      await fs.writeFile(
        `${cwd}/orders.json`,
        JSON.stringify([
          { item: "蓝,笔", status: "paid", amount: "0.10" },
          { item: "蓝,笔", status: "paid", amount: "0.20" },
          { item: '书"签', status: "paid", amount: "5.00" },
          { item: "蓝,笔", status: "cancelled", amount: "99.00" },
        ]),
      );
      prompt =
        "让副手从当前目录orders.json整理report.csv：只含paid订单，按item汇总笔数和金额，顺序按首次出现，金额两位小数。CSV表头固定item,count,total，字段内逗号和双引号按标准CSV转义，UTF-8无BOM、LF换行。主手读产物核对。只用文件工具，不执行命令、不联网。";
    } else if (name === "multi") {
      await fs.writeFile(`${cwd}/money.mjs`, "export const formatPrice = n => String(n);\n");
      await fs.writeFile(
        `${cwd}/invoice.mjs`,
        "import {formatPrice} from './money.mjs';\nexport const invoice = n => 'Total: '+formatPrice(n);\n",
      );
      check =
        "import assert from 'node:assert/strict';import {formatMoney} from './money.mjs';import {invoice} from './invoice.mjs';assert.equal(formatMoney(12.5),'12.50');assert.equal(formatMoney(0),'0.00');assert.equal(formatMoney(null),'—');assert.equal(invoice(12.5),'Total: 12.50');console.log('4 checks passed');\n";
      await fs.writeFile(`${cwd}/check.mjs`, check);
      prompt = `让副手修改money.mjs与invoice.mjs：导出函数formatPrice改名formatMoney，旧名称不再导出，更新调用方；数字格式两位小数，null返回破折号“—”。不得改check.mjs。副手用原生PowerShell精确执行一次下面命令，不增减字符；主手读两个修改文件和原生回执验收，不重跑。只操作当前工作区，不联网。\n${command}`;
    } else if (name.startsWith("draw")) {
      prompt = `${name === "draw" ? "本次由主手直接绘制，不派工" : "让副手绘制，主手验收"}：创建train.svg，画一辆在高速行进中的高铁，1200x500画布，包含流线车头、长车身、6个车窗、转向架、轨道、速度线和远山。使用文件工具写SVG并view_image看图验收，不使用命令、不联网，不额外复制整段SVG到回答。`;
    } else {
      await fs.writeFile(`${cwd}/order.json`, '{"count":3,"unitCents":1250}');
      prompt =
        "让副手读取order.json，生成receipt.json，字段为count、unitCents、totalCents，均为数字。主手读产物核对。只用文件工具，不执行命令或联网。";
    }
    const start = Date.now();
    try {
      await service.submit({ taskId: task.id, requestId: randomUUID(), text: prompt });
      let previousSession: string | undefined;
      if (name === "revise") {
        const running = await until(async () => {
          const t = await service.read(task.id);
          if (t.status !== "running") throw Error("未赶上执行中的需求调整");
          return t.events.some(
            (e) => e.role === "sidekick" && e.kind === "tool" && e.text === "Read",
          )
            ? t
            : false;
        }, 90000);
        previousSession = running.sidekick.sessionId;
        await fs.writeFile(`${root}/revise-before.json`, JSON.stringify(running, null, 2));
        await service.submit({
          taskId: task.id,
          requestId: randomUUID(),
          text: "需求修正：通知正在工作的同一副手，receipt.json改为且只含count、unitYuan、totalYuan三个数字字段，金额单位改成元（从原始分换算）。不要保留Cents字段。主手按这个新要求核对，仍禁止命令和联网。",
        });
      }
      const done = await settle(task.id);
      assert.equal(done.status, "completed", done.error);
      if (name === "data") {
        assert.equal(
          await fs.readFile(`${cwd}/report.csv`, "utf8"),
          'item,count,total\n"蓝,笔",2,0.30\n"书""签",1,5.00\n',
        );
      } else if (name === "multi") {
        assert.equal(await fs.readFile(`${cwd}/check.mjs`, "utf8"), check);
        const money = await import(pathToFileURL(`${cwd}/money.mjs`).href),
          invoice = await import(pathToFileURL(`${cwd}/invoice.mjs`).href);
        assert.equal(money.formatPrice, undefined);
        assert.equal(money.formatMoney(0), "0.00");
        assert.equal(money.formatMoney(null), "—");
        assert.equal(invoice.invoice(12.5), "Total: 12.50");
        assert.equal(done.events.filter((e) => e.kind === "verification").length, 1);
      } else if (name.startsWith("draw")) {
        const svg = await fs.readFile(`${cwd}/train.svg`, "utf8");
        assert.match(svg, /<svg/);
        assert.match(svg, /1200/);
        const actor = name === "draw" ? "lead" : "sidekick";
        const progress = done.events.filter(
          (e) =>
            e.role === actor && e.kind === "tool_input" && JSON.parse(e.text).preview !== undefined,
        );
        assert(progress.length > 2, "未收到多次真实文件草稿进度");
        const first = progress[0]!;
        const execution = done.events.find(
          (e) => e.kind === "tool" && e.toolCallId === first.toolCallId,
        );
        assert(execution && execution.seq > first.seq, "直到执行才显示进度");
        assert(
          done.events.some(
            (e) => e.role === "lead" && e.kind === "tool" && e.text === "view_image",
          ),
        );
      } else {
        assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/receipt.json`, "utf8")), {
          count: 3,
          unitYuan: 12.5,
          totalYuan: 37.5,
        });
        assert(done.events.some((e) => e.kind === "handoff_update"));
        if (previousSession) assert.equal(done.sidekick.sessionId, previousSession);
        // 主手送达更新前副手可能已完成首轮；会话ID和handoff_update才是持久副手证据。
      }
      if (name !== "draw")
        assert(
          done.events.some((e) => e.kind === "handoff"),
          "产物正确但未按用户要求派工",
        );
      results.push({
        name,
        passed: true,
        taskId: task.id,
        elapsedMs: Date.now() - start,
        outputTokens: (done.usage ?? []).reduce((n, u) => n + u.outputTokens, 0),
        tools: done.events.filter((e) => e.kind === "tool").map((e) => `${e.role}:${e.text}`),
        report: done.lead.lastReport,
      });
    } catch (error) {
      results.push({
        name,
        passed: false,
        taskId: task.id,
        elapsedMs: Date.now() - start,
        error: String(error),
      });
    } finally {
      await fs.writeFile(
        `${root}/${name}.json`,
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
