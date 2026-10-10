import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { JsonTaskStore } from "./json-store.js";
import { newTask } from "../domain/task.js";

test(
  "Windows temporary read locks do not turn a successful task save into EPERM",
  { skip: process.platform !== "win32" },
  async () => {
    await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
    const root = await mkdtemp("D:/Apps/TwoCode/qa/unit-state/task-store-");
    const store = new JsonTaskStore(root);
    const task = newTask(
      randomUUID(),
      { workspacePath: root, dual: false, lead: { harness: "pi" }, sidekick: { harness: "pi" } },
      new Date().toISOString(),
    );
    await store.save(task);
    const target = join(root, `${task.id}.json`).replaceAll("'", "''");
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$f=[IO.File]::Open('${target}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::WriteLine('LOCKED'); Start-Sleep -Milliseconds 300; $f.Dispose()`,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once("data", () => resolve());
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code) reject(new Error(`lock holder failed: ${code}`));
        });
      });
      task.title = "saved after temporary lock";
      await store.save(task);
      assert.equal((await store.read(task.id))?.title, task.title);
      assert(!(await readdir(root)).some((name) => name.endsWith(".tmp")));
    } finally {
      await exited;
    }
  },
);
