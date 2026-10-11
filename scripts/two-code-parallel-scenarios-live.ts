import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { imageMessage, projectImageMessage } from "../packages/ui/src/two-code/imageMessage.js";
import type {
  TwoCodePreferences,
  TwoCodeTask,
} from "../packages/services/src/two-code/contract.js";
const root = `D:/Apps/TwoCode/qa/parallel-scenarios-${Date.now()}`;
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
const owned = new Set<string>(),
  manual = new Set<string>(),
  answered = new Set<string>();
const results: Array<Record<string, unknown>> = [];
const sub = service.onDidChange((t) => {
  if (!owned.has(t.id) || manual.has(t.id)) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
    }
});
async function until(id: string, predicate: (t: TwoCodeTask) => boolean) {
  const end = Date.now() + 150000;
  while (Date.now() < end) {
    const t = await service.read(id);
    if (predicate(t)) return t;
    if (t.status !== "running") throw Error(`提前结束：${t.status} ${t.error ?? ""}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("150秒验收超时");
}
async function complete(id: string, label: string) {
  const t = await until(id, (t) => t.status !== "running");
  await fs.writeFile(`${root}/${label}.json`, JSON.stringify(t, null, 2));
  assert.equal(t.status, "completed", t.error);
  return t;
}
const send = (id: string, text: string) =>
  service.submit({ taskId: id, requestId: randomUUID(), text });
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.name} ${m.realModel}`));
  assert(model);
  const preferences: TwoCodePreferences = {
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
  };
  const create = async (name: string) => {
    const workspacePath = `${root}/${name}`;
    await fs.mkdir(workspacePath, { recursive: true });
    const task = await service.create({ workspacePath, ...preferences, title: name });
    owned.add(task.id);
    return task;
  };
  console.log(JSON.stringify({ root }));
  await Promise.all(
    ["attachments", "combination", "cancel-isolation"].map(async (name) => {
      const task = await create(name),
        cwd = task.workspacePath;
      const start = Date.now();
      try {
        if (name === "attachments") {
          const images = await Promise.all(
            [
              ["3621", "#0044cc"],
              ["8459", "#cc3300"],
            ].map(async ([digits, color]) => {
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="white"/><rect x="20" y="60" width="80" height="80" fill="${color}"/><text x="150" y="125" font-size="48" font-family="Arial">${digits}</text></svg>`;
              return service.importImage({
                fileName: "截图.png",
                dataBase64: new Resvg(svg).render().asPng().toString("base64"),
              });
            }),
          );
          assert.notEqual(images[0]!.path, images[1]!.path);
          const prompt = imageMessage(
            "两张附件虽然同名但内容不同。主手先用view_image分别看两张，再让唯一副手也用view_image分别看两张，按附件顺序各报告颜色和四位数字。只用看图和交接工具，不读源码、不执行命令、不联网、不改文件。",
            images,
          );
          assert.equal(projectImageMessage(prompt).attachments?.length, 2);
          await send(task.id, prompt);
          const done = await complete(task.id, "attachments");
          for (const role of ["lead", "sidekick"] as const) {
            assert(
              done.events.filter(
                (e) => e.role === role && e.kind === "tool" && /view_image/.test(e.text),
              ).length >= 2,
            );
            assert.match(done[role].lastReport!, /3621/);
            assert.match(done[role].lastReport!, /8459/);
          }
          for (const image of images)
            assert((await service.readImage(image.path)).dataBase64.length > 0);
        } else if (name === "combination") {
          await fs.writeFile(path.join(cwd, "config.json"), '{"stage":1,"keep":"原样"}\n');
          await send(
            task.id,
            `只操作当前目录${cwd}，让副手读取config.json并只把stage改为2。主手读产物核对。不执行命令、不联网。`,
          );
          const first = await complete(task.id, "combination-first");
          let library = await service.combinations();
          library = await service.saveCombination({
            revision: library.revision,
            name: "低档复核",
            preferences: {
              ...preferences,
              lead: { ...preferences.lead, thinking: "low" },
              sidekick: { ...preferences.sidekick, thinking: "low" },
            },
          });
          const choice = library.items.find((x) => x.name === "低档复核")!;
          await service.configure({ taskId: task.id, preferences: choice.preferences });
          await send(
            task.id,
            `当前目录${cwd}。继续使用同一副手重新读取config.json，只增加checked:true，保留当前stage及keep。主手读文件核对。不执行命令、不联网。`,
          );
          const second = await complete(task.id, "combination-second");
          assert.equal(second.lead.sessionId, first.lead.sessionId);
          assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
          assert.equal(second.lead.selection.thinking, "low");
          assert.equal(second.sidekick.selection.thinking, "low");
          assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "config.json"), "utf8")), {
            stage: 2,
            keep: "原样",
            checked: true,
          });
          assert.equal((await service.combinations()).defaultId, "initial-default");
        } else {
          manual.add(task.id);
          await fs.writeFile(
            path.join(cwd, "blocked.mjs"),
            "import fs from 'node:fs';fs.writeFileSync(new URL('unexpected.txt',import.meta.url),'BAD');",
          );
          await send(
            task.id,
            `让副手用原生PowerShell精确执行一次 node '${cwd.replaceAll("\\", "/")}/blocked.mjs'，不改文件、不读取脚本、不联网。`,
          );
          const pending = await until(task.id, (t) =>
            t.permissions.some((p) => p.role === "sidekick"),
          );
          const other = await create("unaffected");
          await send(
            other.id,
            `只在当前目录${other.workspacePath}，让副手用Write创建ok.txt，内容UNRELATED_OK，主手读产物核对。只用文件工具，不执行命令、不联网。`,
          );
          assert.equal((await service.read(other.id)).status, "running");
          const stopped = await service.cancel(task.id);
          assert.equal(stopped.status, "cancelled");
          const otherDone = await complete(other.id, "unaffected");
          assert.equal(
            (await fs.readFile(path.join(other.workspacePath, "ok.txt"), "utf8")).trim(),
            "UNRELATED_OK",
          );
          assert.notEqual(otherDone.sidekick.sessionId, pending.sidekick.sessionId);
          const permission = pending.permissions.find((p) => p.role === "sidekick")!;
          await assert.rejects(
            service.respond({ taskId: task.id, permissionId: permission.id, allow: true }),
          );
          await assert.rejects(fs.access(path.join(cwd, "unexpected.txt")));
          assert.equal((await service.read(task.id)).status, "cancelled");
        }
        results.push({ name, passed: true, taskId: task.id, elapsedMs: Date.now() - start });
      } catch (error) {
        results.push({ name, passed: false, taskId: task.id, error: String(error) });
      } finally {
        if ((await service.read(task.id)).status === "running") await service.cancel(task.id);
        await fs.writeFile(
          `${root}/${name}-final.json`,
          JSON.stringify(await service.read(task.id), null, 2),
        );
        console.log(JSON.stringify(results.find((r) => r.name === name)));
      }
    }),
  );
} finally {
  sub.dispose();
  for (const id of owned)
    if ((await service.read(id)).status === "running") await service.cancel(id);
  await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
  await disposeServiceResourcesAndWait(services);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
