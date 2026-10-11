import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  piEntry,
  stepExecutable,
  claudeExecutable,
} from "../packages/services/src/two-code/adapters/paths.js";
import {
  piToolExtension,
  stepToolExtension,
} from "../packages/services/src/two-code/adapters/tool-bridge.js";
import { query } from "@anthropic-ai/claude-agent-sdk";

const root = `D:/Apps/TwoCode/qa/shell-inventory-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const results: Record<string, unknown> = {};
for (const harness of ["pi", "step-code"] as const) {
  const step = harness === "step-code",
    entry = step ? await stepExecutable() : await piEntry();
  if (!entry) throw Error(`${harness} missing`);
  const output = path.join(root, harness + ".json"),
    extension = path.join(root, harness + "-tools.mjs"),
    inventory = path.join(root, harness + "-inventory.mjs");
  await fs.writeFile(extension, step ? stepToolExtension : piToolExtension);
  await fs.writeFile(
    inventory,
    `import fs from 'node:fs';export default function(pi){pi.registerCommand('two-code-shell-inventory',{description:'QA inventory',handler:async()=>{fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({active:pi.getActiveTools(),shells:pi.getAllTools().filter(t=>/^(powershell|bash|run_command|pwsh)$/i.test(t.name))}));}});}`,
  );
  const child = spawn(
    step ? entry : process.execPath,
    [
      ...(step ? [] : [entry]),
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--extension",
      extension,
      "--extension",
      inventory,
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: "pipe",
      env: { ...process.env, TWO_CODE_HAS_SIDEKICK: "0", ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  let buffer = "";
  const pending = new Map<string, { resolve: (x: any) => void; reject: (e: Error) => void }>();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const i = buffer.indexOf("\n"),
        line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === "response") {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.success) p?.resolve(msg.data);
          else p?.reject(Error(msg.error));
        }
      } catch {}
    }
  });
  const timer = setTimeout(() => child.kill(), 20000);
  const send = (type: string, extra = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
    });
  try {
    await send("get_commands");
    await send("prompt", { message: "/two-code-shell-inventory" });
    results[harness] = JSON.parse(await fs.readFile(output, "utf8"));
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
const executable = await claudeExecutable();
if (executable) {
  const controller = new AbortController();
  const q = query({
    prompt: "只回复OK，不调用工具。",
    options: {
      cwd: root,
      pathToClaudeCodeExecutable: executable,
      abortController: controller,
      spawnClaudeCodeProcess: (o) =>
        spawn(o.command, o.args, { cwd: o.cwd, env: o.env, windowsHide: true, stdio: "pipe" }),
      permissionMode: "plan",
      maxTurns: 1,
    },
  });
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    for await (const message of q) {
      if (message.type === "system" && message.subtype === "init") {
        results["claude-code"] = { tools: message.tools, model: message.model };
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!results["claude-code"])
      results["claude-code"] = { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    q.close();
  }
}
await fs.writeFile(path.join(root, "result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ root, results }));
