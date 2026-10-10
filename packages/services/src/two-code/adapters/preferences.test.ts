import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JsonPreferences } from "./preferences.js";

test("multiple windows write complete preferences without sharing temporary files", async () => {
  const base = process.env.TWO_CODE_TEST_ROOT || "D:/Apps/TwoCode/qa/unit-state";
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "preferences-"));
  const stores = [new JsonPreferences(root), new JsonPreferences(root)];
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      stores[i % 2]!.write({
        dual: true,
        lead: { harness: "pi", model: `model-${i}` },
        sidekick: { harness: "claude-code" },
      }),
    ),
  );
  assert.match((await stores[0]!.read()).lead.model!, /^model-\d+$/);
  assert.deepEqual(await readdir(root), ["preferences.json"]);
  await writeFile(join(root, "preferences.json"), '{"lead":null}');
  await assert.rejects(stores[0]!.read(), /配置损坏/);
  assert.equal(await readFile(join(root, "preferences.json"), "utf8"), '{"lead":null}');
});
