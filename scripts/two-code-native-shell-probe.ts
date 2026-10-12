import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { nativeWindowsShellEnvironment } from "../packages/services/src/two-code/adapters/native-shell.js";
import { stepExecutable, piEntry } from "../packages/services/src/two-code/adapters/paths.js";

const root = `D:/Apps/TwoCode/qa/native-shell-${Date.now()}`;
await fs.mkdir(root + "/workspace with space", { recursive: true });
await fs.writeFile(
  root + "/owner.json",
  JSON.stringify({ kind: "two-code-native-shell-probe", root }),
);
async function probe(harness: "pi" | "step", fixed: boolean) {
  const cwd = root + "/workspace with space",
    config = root + `/${harness}-${fixed}`;
  await fs.mkdir(config, { recursive: true });
  const entry = harness === "step" ? await stepExecutable() : await piEntry();
  if (!entry) throw Error("Native CLI missing");
  const args = [
    ...(harness === "pi" ? [entry] : []),
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    "--no-approve",
  ];
  const child = spawn(harness === "pi" ? process.execPath : entry, args, {
    cwd,
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      ...(fixed ? await nativeWindowsShellEnvironment() : {}),
      PI_CODING_AGENT_DIR: config,
      STEP_CODING_AGENT_DIR: config,
      STEPCODE_CONFIG_DIR: config,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
  let buffer = "",
    done = false;
  const result = await new Promise<any>((resolve) => {
    const finish = (value: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
      child.stdin.end();
      child.kill();
    };
    const timer = setTimeout(() => finish({ error: "RPC probe timed out" }), 25000);
    child.on("error", (e) => finish({ error: e.message }));
    child.on("exit", (code) => finish({ error: "CLI exited " + code }));
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const v = JSON.parse(line);
          if (v.type === "response" && v.id === "shell-probe")
            finish({ success: v.success, data: v.data, error: v.error });
        } catch {}
      }
    });
    child.stdin.write(
      JSON.stringify({
        id: "shell-probe",
        type: "bash",
        command: "uname -s; printf 'WORKSPACE='; pwd",
      }) + "\n",
    );
  });
  return { harness, fixed, ...result };
}
const results = [];
for (const harness of ["pi", "step"] as const)
  for (const fixed of [false, true]) {
    const r = await probe(harness, fixed);
    results.push(r);
    console.log(JSON.stringify(r));
  }
await fs.writeFile(root + "/results.json", JSON.stringify(results, null, 2));
await fs.writeFile(root + "/closed.json", JSON.stringify({ at: new Date().toISOString() }));
console.log(JSON.stringify({ root }));
if (
  results
    .filter((r) => r.fixed)
    .some((r) => !r.success || !String(r.data?.output ?? "").includes("MINGW"))
)
  process.exitCode = 1;
