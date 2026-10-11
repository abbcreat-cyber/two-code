import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = `D:/Apps/TwoCode/qa/fusion-runtime-${Date.now()}`,
  cwd = `${root}/workspace`,
  nonce = randomUUID();
await fs.mkdir(cwd, { recursive: true });
await fs.writeFile(
  `${cwd}/server.mjs`,
  `import http from 'node:http';import fs from 'node:fs';const nonce=${JSON.stringify(nonce)};const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({pid:process.pid,nonce}));if(req.method==='POST'&&req.url==='/stop?nonce='+nonce)server.close(()=>process.exit(0));});server.listen(0,'127.0.0.1',()=>{fs.appendFileSync(new URL('starts.log',import.meta.url),'once\\n');fs.writeFileSync(new URL('runtime.json',import.meta.url),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:'+server.address().port,nonce}));});setTimeout(()=>server.close(()=>process.exit(0)),180000).unref();`,
);
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { ITwoCodeService } = await import("../packages/services/src/index.js");
const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  }),
  service = services.get(ITwoCodeService);
let taskId = "";
const answered = new Set<string>();
const sub = service.onDidChange((t) => {
  if (t.id !== taskId) return;
  for (const p of t.permissions) {
    if (answered.has(p.id)) continue;
    answered.add(p.id);
    const command = String(JSON.parse(p.detail).command ?? "").replaceAll("\\", "/");
    const allow =
      p.role === "sidekick" &&
      p.title === "PowerShell" &&
      ((command.includes(`${cwd}/server.mjs`) && command.includes("-WindowStyle Hidden")) ||
        (command.includes(`${cwd}/runtime.json`) &&
          command.includes("Invoke-RestMethod") &&
          !command.includes("Start-Process")));
    void service.respond({ taskId: t.id, permissionId: p.id, allow }).catch(() => {});
  }
});
async function settled() {
  const end = Date.now() + 160000;
  while (Date.now() < end) {
    const t = await service.read(taskId);
    if (t.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  await service.cancel(taskId);
  throw Error("runtime task timeout");
}
let runtime: { pid: number; url: string; nonce: string } | undefined;
try {
  const model = (await service.catalog())
    .find((h) => h.id === "claude-code")
    ?.models.find((m) => /deepseek/i.test(`${m.realModel} ${m.name}`));
  assert(model);
  const task = await service.create({
    workspacePath: cwd,
    dual: true,
    mode: "edit",
    lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    sidekick: {
      harness: "claude-code",
      model: model.id,
      provider: model.provider,
      thinking: "high",
    },
  });
  taskId = task.id;
  console.log(JSON.stringify({ root, taskId }));
  const command = `$p = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList '${cwd}/server.mjs' -WorkingDirectory '${cwd}' -WindowStyle Hidden -RedirectStandardOutput '${cwd}/server.out.log' -RedirectStandardError '${cwd}/server.err.log' -PassThru; $p.Id`;
  await service.submit({
    taskId,
    requestId: randomUUID(),
    text: `这是明确授权的本地运行时保留测试。仅限${cwd}，不联网到外部，不用GUI或技能。主手把下列已定稿的启动命令原样交给唯一副手用原生PowerShell执行一次：\n${command}\nserver.mjs已提供，不读取或修改它。服务器必须跨下一轮交接继续保留，双方不要关闭或重复启动。主手只用read_file读取runtime.json确认PID和地址后简短报告。`,
  });
  const first = await settled();
  assert.equal(first.status, "completed", first.error);
  await fs.writeFile(`${root}/first.json`, JSON.stringify(first, null, 2));
  runtime = JSON.parse(await fs.readFile(`${cwd}/runtime.json`, "utf8"));
  assert(runtime);
  const response = await fetch(runtime.url, { signal: AbortSignal.timeout(5000) }).then((r) =>
    r.json(),
  );
  assert.equal(response.nonce, nonce);
  assert.equal(response.pid, runtime.pid);
  assert(first.sidekick.availableTools?.length);
  for (const denied of [
    "Agent",
    "Task",
    "AskUserQuestion",
    "EnterPlanMode",
    "ExitPlanMode",
    "SendMessage",
    "Workflow",
    "ListAgents",
    "PushNotification",
    "ScheduleWakeup",
    "CronCreate",
    "CronDelete",
    "ReportFindings",
  ])
    assert(!first.sidekick.availableTools.includes(denied));
  const check = `$runtime = Get-Content -LiteralPath '${cwd}/runtime.json' -Raw | ConvertFrom-Json; Invoke-RestMethod -Uri $runtime.url`;
  await service.submit({
    taskId,
    requestId: randomUUID(),
    text: `继续使用同一副手。上一轮服务器已经核实仍在运行；不能重启或修改任何文件。副手仅用原生PowerShell执行一次下面的已定稿检查命令并报告返回PID，主手不要再发请求：\n${check}\n只访问这个已有127.0.0.1服务，不访问其他网络、GUI或技能。`,
  });
  const second = await settled();
  assert.equal(second.status, "completed", second.error);
  assert.equal(second.sidekick.sessionId, first.sidekick.sessionId);
  assert.match(second.lead.lastReport!, new RegExp(String(runtime.pid)));
  assert.equal(await fs.readFile(`${cwd}/starts.log`, "utf8"), "once\n");
  await fs.writeFile(`${root}/second.json`, JSON.stringify(second, null, 2));
  console.log(
    JSON.stringify({ root, passed: true, pid: runtime.pid, tools: first.sidekick.availableTools }),
  );
} finally {
  sub.dispose();
  if (taskId && (await service.read(taskId)).status === "running") await service.cancel(taskId);
  runtime ??= await fs
    .readFile(`${cwd}/runtime.json`, "utf8")
    .then(JSON.parse)
    .catch(() => undefined);
  if (runtime?.nonce === nonce)
    await fetch(`${runtime.url}/stop?nonce=${nonce}`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  await disposeServiceResourcesAndWait(services);
}
