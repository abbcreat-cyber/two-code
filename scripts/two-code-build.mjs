import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, ".two-code-work"), { recursive: true });
const log = fs.openSync(path.join(root, ".two-code-work/build-production.log"), "w");
const child = spawn(
  process.execPath,
  [
    "D:/dev/npm-global/node_modules/pnpm/bin/pnpm.cjs",
    "--filter",
    "@zcode/desktop",
    "build:no-runtime-assets",
  ],
  {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ZCODE_ENV: "production", NODE_ENV: "production" },
    stdio: ["ignore", log, log],
  },
);
console.log(`production build pid=${child.pid}`);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  fs.closeSync(log);
  console.log(`production build exit=${code}; log=.two-code-work/build-production.log`);
  process.exitCode = code ?? 1;
});
