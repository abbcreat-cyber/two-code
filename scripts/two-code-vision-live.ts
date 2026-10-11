import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
const root = `D:/Apps/TwoCode/qa/vision-live-${Date.now()}`;
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
const ids: string[] = [],
  results: Array<Record<string, unknown>> = [];
async function settle(id: string) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (t.status !== "running") return t;
    if (t.permissions.length)
      throw Error(`本题不需要的额外权限:${t.permissions.map((p) => p.title)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("视觉验收超时");
}
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  console.log(JSON.stringify({ root }));
  await Promise.all(
    ["pixels", "svg"]
      .filter((n) => !process.env.TWO_CODE_VISION_CASE || process.env.TWO_CODE_VISION_CASE === n)
      .map(async (name) => {
        const cwd = `${root}/${name}`;
        await fs.mkdir(cwd, { recursive: true });
        const task = await service.create({
          workspacePath: cwd,
          dual: true,
          mode: "edit",
          lead:
            name === "svg"
              ? {
                  harness: "pi",
                  provider: "ds-tencent",
                  model: "claude-sonnet-4-8",
                  thinking: "max",
                }
              : { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
          sidekick:
            name === "svg"
              ? {
                  harness: "pi",
                  provider: "ds-tencent",
                  model: "claude-sonnet-4-8",
                  thinking: "high",
                }
              : {
                  harness: "claude-code",
                  provider: model.provider,
                  model: model.id,
                  thinking: "high",
                },
        });
        ids.push(task.id);
        try {
          if (name === "pixels") {
            const svg =
              '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><circle cx="135" cy="100" r="65" fill="#185ceb"/><path d="M430 225 L505 345 L355 345Z" fill="#e63030"/><text x="220" y="205" font-size="42" font-family="Arial" fill="black">7294</text></svg>';
            await fs.writeFile(`${cwd}/probe.png`, new Resvg(svg).render().asPng());
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: "真实看图测试：主手先用view_image读取当前目录probe.png，然后让唯一副手也用view_image独立看同一图片。分别报告图形的颜色/形状/相对位置及中间四位数字。只允许view_image和交接工具，不读文件源码、不用命令、网络或GUI。不能依据副手文字冒充主手看图。",
            });
          } else {
            await fs.copyFile(
              "D:/Apps/TwoCode/data/.zcode/workspace/default/sunset-waterfall.svg",
              `${cwd}/scene.svg`,
            );
            await service.submit({
              taskId: task.id,
              requestId: randomUUID(),
              text: "给当前目录scene.svg做真实视觉验收：主手先用view_image直接看SVG渲染图，再让唯一副手用view_image独立看同一图。分别描述太阳、瀑布在画面中的位置、色调与一个具体构图观察。只用view_image和交接工具，不读源码、不查渲染命令、不联网、不用GUI。最终说明你是否实际看到了像素。",
            });
          }
          const done = await settle(task.id);
          assert.equal(done.status, "completed", done.error);
          for (const role of ["lead", "sidekick"])
            assert(
              done.events.some(
                (e) => e.role === role && e.kind === "tool" && /view_image/.test(e.text),
              ),
              `${role}未看图`,
            );
          if (name === "pixels") {
            for (const report of [done.lead.lastReport!, done.sidekick.lastReport!]) {
              assert.match(report, /7294/);
              assert.match(report, /蓝/);
              assert.match(report, /红/);
              assert.match(report, /三角/);
            }
          } else {
            assert.match(done.lead.lastReport!, /瀑布/);
            assert.match(done.lead.lastReport!, /右/);
          }
          results.push({
            name,
            passed: true,
            id: task.id,
            lead: done.lead.lastReport,
            sidekick: done.sidekick.lastReport,
          });
        } catch (e) {
          results.push({ name, passed: false, error: String(e) });
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
  for (const id of ids) if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
