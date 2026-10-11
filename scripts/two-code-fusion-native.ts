import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { ClaudeAdapter } from "../packages/services/src/two-code/adapters/claude.js";
import { sidekickInstruction } from "../packages/services/src/two-code/domain/task.js";

const root = `D:/Apps/TwoCode/qa/fusion-native-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
await fs.writeFile(
  `${root}/wait.mjs`,
  "import fs from 'node:fs';fs.writeFileSync(new URL('started.txt',import.meta.url),'started');setTimeout(()=>fs.writeFileSync(new URL('late.txt',import.meta.url),'late'),15000);",
);
const adapter = new ClaudeAdapter();
const controller = new AbortController();
const events: Array<{ kind: string; text: string }> = [];
const timer = setTimeout(() => controller.abort(), 150000);
console.log(JSON.stringify({ root }));
try {
  const running = adapter.run({
    role: "sidekick",
    cwd: root,
    sessionDir: `${root}/session`,
    selection: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
    mode: "edit",
    systemPrompt: sidekickInstruction,
    signal: controller.signal,
    prompt: `本次派工：仅在${root}，只用原生PowerShell执行一次 node '${root}/wait.mjs'，run_in_background设为false。不要读取或修改脚本，不要重试，不用其他工具，等命令完成后报告。`,
    emit: async (e) => {
      events.push(e);
    },
    permission: async (name, detail) => {
      const args = JSON.parse(detail);
      if (name === "PowerShell")
        return String(args.command).replaceAll("\\", "/").includes(`${root}/wait.mjs`);
      return (
        ["Write", "Read"].includes(name) &&
        path.resolve(args.file_path ?? "") === path.resolve(root, "updated.txt")
      );
    },
  });
  void running.catch(() => {});
  const deadline = Date.now() + 90000;
  while (
    !(await fs.access(`${root}/started.txt`).then(
      () => true,
      () => false,
    ))
  ) {
    if (Date.now() > deadline) throw Error("原生工具未启动");
    await new Promise((r) => setTimeout(r, 200));
  }
  const before = events.filter((e) => e.kind === "session").map((e) => e.text);
  await adapter.update(
    `<lead_update>立即停止原等待任务，不要重跑。只用Write创建${root}/updated.txt，内容UPDATE_OK。不要再运行命令。简短报告当前结果。</lead_update>`,
  );
  const report = await running;
  assert.equal((await fs.readFile(`${root}/updated.txt`, "utf8")).trim(), "UPDATE_OK");
  assert.deepEqual(
    events.filter((e) => e.kind === "session").map((e) => e.text),
    before,
  );
  await new Promise((r) => setTimeout(r, 16000));
  await assert.rejects(fs.access(`${root}/late.txt`));
  await fs.writeFile(
    `${root}/result.json`,
    JSON.stringify({ passed: true, report, events }, null, 2),
  );
  console.log(JSON.stringify({ root, passed: true, session: report.sessionId }));
} finally {
  clearTimeout(timer);
  controller.abort();
  await adapter.close();
  await fs.writeFile(`${root}/events.json`, JSON.stringify(events, null, 2));
}
