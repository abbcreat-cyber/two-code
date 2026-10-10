import { spawn } from "node:child_process";
import fs from "node:fs/promises";
const root = `D:/Apps/TwoCode/qa/launch-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  TWO_CODE_BACKGROUND: "1",
  TWO_CODE_HOME: root + "/data",
  ZCODE_DATA_BASE_DIR: root + "/data",
  ZCODE_DESKTOP_USER_DATA_DIR: root + "/electron",
  ZCODE_DESKTOP_SESSION_DATA_DIR: root + "/electron/session",
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  ELECTRON_ENABLE_LOGGING: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  "D:/Apps/TwoCode/releases/0.1.0/win-unpacked/Two Code.exe",
  ["--enable-logging=stderr", "--disable-gpu", "--remote-debugging-port=19339"],
  { env, windowsHide: true, stdio: "pipe" },
);
let output = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (output += c));
console.log(JSON.stringify({ pid: child.pid, root }));
child.once("exit", (code) => console.log(JSON.stringify({ exit: code })));
await new Promise((resolve) => setTimeout(resolve, 12000));
await fs.writeFile(root + "/launch.log", output);
console.log(output.slice(-6500));
if (child.exitCode === null) {
  const stop = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise((r) => stop.once("exit", r));
}
