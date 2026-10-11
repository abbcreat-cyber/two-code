import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
const root = process.env.TWO_CODE_VISION_REFRESH_ROOT;
if (!root) throw Error("需要本轮图片测试目录");
const previous = JSON.parse(await fs.readFile(`${root}/pixels.json`, "utf8"));
assert.equal(previous.status, "completed");
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
await fs.copyFile(`${root}/pixels/probe.png`, `${root}/before-refresh.png`);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><circle cx="135" cy="100" r="65" fill="#e63030"/><path d="M430 225 L505 345 L355 345Z" fill="#008040"/><text x="220" y="205" font-size="42" font-family="Arial" fill="black">1568</text></svg>';
await fs.writeFile(`${root}/pixels/probe.png`, new Resvg(svg).render().asPng());
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
const answered = new Set<string>();
const sub = service.onDidChange((t) => {
  if (t.id !== previous.id) return;
  for (const p of t.permissions)
    if (!answered.has(p.id)) {
      answered.add(p.id);
      void service.respond({ taskId: t.id, permissionId: p.id, allow: false }).catch(() => {});
    }
});
let passed = false;
try {
  await service.submit({
    taskId: previous.id,
    requestId: randomUUID(),
    text: "当前目录probe.png的内容已换成新图片，文件名不变。主手先重新调用view_image读当前像素，再让原副手也重新调用view_image读同一路径。分别报告本轮圆形和三角形的颜色、中间四位数字；以这次工具返回的图片为准。只用view_image和交接工具，不读源码、不执行命令、不联网、不改文件。",
  });
  const end = Date.now() + 150000;
  let done = await service.read(previous.id);
  while (done.status === "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    done = await service.read(previous.id);
  }
  await fs.writeFile(`${root}/image-refresh.json`, JSON.stringify(done, null, 2));
  assert.equal(done.status, "completed", done.error || "图片更新验收超时");
  assert.equal(done.lead.sessionId, previous.lead.sessionId);
  assert.equal(done.sidekick.sessionId, previous.sidekick.sessionId);
  for (const role of ["lead", "sidekick"] as const) {
    assert(
      done.events.some(
        (e) =>
          e.seq > previous.events.at(-1).seq &&
          e.role === role &&
          e.kind === "tool" &&
          /view_image/.test(e.text),
      ),
    );
    assert.match(done[role].lastReport!, /1568/);
    assert.match(done[role].lastReport!, /绿/);
    assert.match(done[role].lastReport!, /红/);
  }
  passed = true;
} finally {
  sub.dispose();
  if ((await service.read(previous.id)).status === "running") await service.cancel(previous.id);
  await disposeServiceResourcesAndWait(services);
  await fs.writeFile(
    `${root}/image-refresh-results.json`,
    JSON.stringify({ root, passed }, null, 2),
  );
  console.log(JSON.stringify({ root, passed }));
  if (!passed) process.exitCode = 1;
}
