import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const repo = path.resolve(import.meta.dirname, "..");
const desktop = path.join(repo, "packages/desktop");
const require = createRequire(path.join(desktop, "package.json"));
const cli = path.join(
  path.dirname(require.resolve("electron-builder/package.json")),
  "out/cli/cli.js",
);
fs.mkdirSync(path.join(repo, ".two-code-work"), { recursive: true });
const log = fs.openSync(path.join(repo, ".two-code-work/package.log"), "w");
const child = spawn(
  process.execPath,
  [
    cli,
    "--config",
    "electron-builder.config.js",
    "--dir",
    "--win",
    "--x64",
    "--publish",
    "never",
    `-c.electronDist=${path.join(repo, "node_modules/electron/dist")}`,
  ],
  {
    cwd: desktop,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      ZCODE_ENV: "production",
      NODE_ENV: "production",
      ZCODE_DESKTOP_DIST_DIR: "D:/Apps/TwoCode/releases/0.1.0",
    },
  },
);
console.log(`packaging pid=${child.pid}`);
child.on("exit", (code) => {
  fs.closeSync(log);
  console.log(`packaging exit=${code}; log=.two-code-work/package.log`);
  process.exitCode = code ?? 1;
});
