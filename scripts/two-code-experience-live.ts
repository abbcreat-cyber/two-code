import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const root = `D:/Apps/TwoCode/qa/experience-live-${Date.now()}`;
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
const owned = new Set<string>(),
  results: Array<Record<string, unknown>> = [];
async function until<T>(f: () => Promise<T | false>, timeout = 150000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await f();
    if (value !== false) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(`验收超时 ${timeout}ms`);
}
const settle = (id: string) =>
  until(async () => {
    const t = await service.read(id);
    return t.status !== "running" && t;
  });
const submit = (id: string, text: string) =>
  service.submit({ taskId: id, requestId: randomUUID(), text });
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  console.log(JSON.stringify({ root, model: model.realModel }));
  await Promise.all(
    ["permission", "batch", "recover", "burst"]
      .filter(
        (name) =>
          !process.env.TWO_CODE_EXPERIENCE_CASES ||
          process.env.TWO_CODE_EXPERIENCE_CASES.split(",").includes(name),
      )
      .map(async (name) => {
        const cwd = `${root}/${name}/中文 目录`;
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
        owned.add(task.id);
        try {
          const constraints = `只操作当前工作区${cwd}，不联网、不用GUI或技能。`;
          if (name === "permission" || name === "burst") {
            await submit(
              task.id,
              `${constraints}本题第一步明确由主手亲自执行，不委派：用原生powershell工具运行一次 Write-Output (17 + 25)，随后回复结果。不要使用其他工具。`,
            );
            const waiting = await until(async () => {
              const t = await service.read(task.id);
              return t.permissions.some((p) => p.role === "lead") && t;
            });
            const permission = waiting.permissions.find((p) => p.role === "lead")!;
            const update = {
              taskId: task.id,
              requestId: randomUUID(),
              text: `${constraints}修改要求：撤销尚未批准的主手命令，禁止执行任何命令。改让唯一副手只用Write创建answer.txt内容42，主手read_file核对。`,
            };
            if (name === "burst") {
              await Promise.all([
                service.submit(update),
                service.submit(update),
                submit(
                  task.id,
                  "最后补充：保留上一条全部限制和分工，answer.txt的最终内容改为99，主手核对99。",
                ),
              ]);
            } else await service.submit(update);
            await until(
              async () =>
                !(await service.read(task.id)).permissions.some((p) => p.id === permission.id),
              10000,
            );
            await assert.rejects(
              service.respond({ taskId: task.id, permissionId: permission.id, allow: true }),
              /失效/,
            );
            const done = await settle(task.id);
            assert.equal(done.status, "completed", done.error);
            assert.equal(
              (await fs.readFile(`${cwd}/answer.txt`, "utf8")).trim(),
              name === "burst" ? "99" : "42",
            );
            assert.equal(done.lead.sessionId, waiting.lead.sessionId);
            if (name === "burst") {
              assert.equal(done.events.filter((e) => e.continuation).length, 2);
              assert.equal(
                done.events.filter((e) => e.requestId === update.requestId && e.role === "user")
                  .length,
                1,
              );
            }
            results.push({ name, passed: true, oldPermissionRemoved: true });
          } else if (name === "batch") {
            await fs.writeFile(
              `${cwd}/账单.json`,
              JSON.stringify([
                { item: "茶", amount: 12.5 },
                { item: "点心", amount: 7.25 },
                { item: "退款", amount: -2.5 },
              ]),
            );
            await submit(
              task.id,
              `${constraints}用同一副手只读账单.json，写汇总.json，格式{"count":3,"total":17.25}，主手read_file核对。只用Read/Write/read_file，不执行命令。`,
            );
            const first = await settle(task.id);
            assert.equal(first.status, "completed", first.error);
            assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/汇总.json`, "utf8")), {
              count: 3,
              total: 17.25,
            });
            const seq = first.events.at(-1)!.seq;
            await submit(
              task.id,
              `${constraints}一次批量调整：沿用已核实count=3,total=17.25，不重新读取账单、不重新计算。让原副手只用Write把汇总.json改为{"currency":"CNY","count":3,"total":17.25}，并新增说明.md，内容两行“笔数：3”和“合计：CNY 17.25”。主手读两个产物核对。禁止命令。`,
            );
            const done = await settle(task.id);
            assert.equal(done.status, "completed", done.error);
            assert.equal(done.sidekick.sessionId, first.sidekick.sessionId);
            assert.deepEqual(JSON.parse(await fs.readFile(`${cwd}/汇总.json`, "utf8")), {
              currency: "CNY",
              count: 3,
              total: 17.25,
            });
            const note = await fs.readFile(`${cwd}/说明.md`, "utf8");
            assert.match(note, /笔数：3/);
            assert.match(note, /合计：CNY 17.25/);
            assert.equal(done.events.filter((e) => e.seq > seq && e.kind === "handoff").length, 1);
            assert(
              !done.events.some(
                (e) =>
                  e.seq > seq && e.role === "sidekick" && e.kind === "tool" && e.text === "Read",
              ),
            );
            results.push({ name, passed: true, sameSidekick: true, oneBatch: true });
          } else {
            await submit(
              task.id,
              `${constraints}让副手仅用Read读取missing.json一次，若不存在直接报告缺失，不创建文件、不重试、不使用其他工具；主手据此说明结果。记住暗号松果。`,
            );
            const first = await settle(task.id);
            assert.equal(first.status, "completed", first.error);
            assert.match(first.lead.lastReport!, /不存在|缺失|未找到/);
            await fs.writeFile(`${cwd}/missing.json`, '{"answer":"松果恢复成功"}');
            await submit(
              task.id,
              `${constraints}missing.json已补齐。让原副手读一次这个文件，再用Write写result.txt为answer值。副手同时报告上轮暗号，主手read_file核对result.txt并回答暗号与结果。不执行命令。`,
            );
            const done = await settle(task.id);
            assert.equal(done.status, "completed", done.error);
            assert.equal(done.sidekick.sessionId, first.sidekick.sessionId);
            assert.equal((await fs.readFile(`${cwd}/result.txt`, "utf8")).trim(), "松果恢复成功");
            assert.match(done.lead.lastReport!, /松果/);
            results.push({ name, passed: true, sameSidekick: true });
          }
        } catch (error) {
          results.push({ name, passed: false, error: String(error) });
        } finally {
          await fs.writeFile(
            `${root}/${name}.json`,
            JSON.stringify(await service.read(task.id), null, 2),
          );
          if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
          console.log(JSON.stringify(results.find((r) => r.name === name)));
        }
      }),
  );
} finally {
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
