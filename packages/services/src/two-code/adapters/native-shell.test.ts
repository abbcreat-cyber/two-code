import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { nativeWindowsShellEnvironment } from "./native-shell.js";

test("PATH中的非默认Git安装提供原生Bash，WSL路径不抢占且不修改原环境", async () => {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/native-shell-");
  await mkdir(join(root, "Git", "cmd"), { recursive: true });
  await mkdir(join(root, "Git", "bin"));
  await mkdir(join(root, "System32"));
  await writeFile(join(root, "Git", "cmd", "git.exe"), "");
  await writeFile(join(root, "Git", "bin", "bash.exe"), "");
  await writeFile(join(root, "System32", "bash.exe"), "");
  const env = { Path: [join(root, "System32"), join(root, "Git", "cmd")].join(delimiter) };
  const before = { ...env };
  const result = await nativeWindowsShellEnvironment(env, "win32");
  assert.equal(result.TWO_CODE_NATIVE_BASH, join(root, "Git", "bin", "bash.exe"));
  assert.equal(result.Path, join(root, "Git", "bin") + delimiter + env.Path);
  assert.deepEqual(env, before);
  assert.equal(Object.hasOwn(result, "PATH"), false);
  assert.deepEqual(await nativeWindowsShellEnvironment(env, "linux"), {});
});

test("无真实Git Bash时不伪造可用路径", async () => {
  assert.deepEqual(
    await nativeWindowsShellEnvironment({ PATH: "D:/not-existing-shell-fixture" }, "win32"),
    {},
  );
});
