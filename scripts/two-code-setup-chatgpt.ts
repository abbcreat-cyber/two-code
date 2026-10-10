import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { atomicWritePrivateTextFile } from "../packages/shared/src/node.js";
import { TwoCodeConnections } from "../packages/services/src/two-code/adapters/connections.js";
import { JsonPreferences } from "../packages/services/src/two-code/adapters/preferences.js";
const source = process.argv[2];
assert(source, "Supply the authorized Pi auth.json path; never pass tokens on command line");
const root = process.env.TWO_CODE_HOME || "D:/Apps/TwoCode/data";
const agentDir = path.join(root, "pi-chatgpt");
await fs.mkdir(agentDir, { recursive: true });
const auth = JSON.parse(await fs.readFile(source, "utf8"));
assert(auth.openai?.type === "oauth" && auth.openai?.clientId && auth.openai?.access);
try {
  await fs.access(path.join(agentDir, "auth.json"));
} catch {
  await atomicWritePrivateTextFile(
    path.join(agentDir, "auth.json"),
    JSON.stringify({ openai: auth.openai }),
  );
}
const models = [
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-6-sol", name: "GPT-6 Sol" },
  { id: "gpt-6-luna", name: "GPT-6 Luna" },
];
await atomicWritePrivateTextFile(
  path.join(root, "chatgpt-connection.json"),
  JSON.stringify({
    agentDir,
    node: "C:/Program Files/nodejs/node.exe",
    proxy: "http://127.0.0.1:7897",
    models,
  }),
);
const manager = new TwoCodeConnections(root);
let view = await manager.read();
const old = view.connections.find((c) => c.id === "native:pi:codex-gw");
if (old) view = await manager.remove({ id: old.id, revision: view.revision });
const prefs = new JsonPreferences(root),
  current = await prefs.read();
let changed = false;
for (const role of ["lead", "sidekick"] as const) {
  if (current[role].harness === "pi" && current[role].provider === "codex-gw") {
    current[role] = { ...current[role], provider: "two-code-chatgpt", modelLabel: undefined };
    changed = true;
  }
}
if (changed) await prefs.write(current);
manager.dispose();
console.log(
  JSON.stringify({
    configured: true,
    root,
    models: models.map((m) => m.id),
    migratedOldGatewayDefault: changed,
  }),
);
