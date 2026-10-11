import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { JsonPreferences } from "./preferences.js";
import type { TwoCodePreferences } from "../contract.js";
const base: TwoCodePreferences = {
  dual: true,
  mode: "edit",
  lead: {
    harness: "step-code",
    provider: "step-plan",
    model: "step-5-preview",
    thinking: "medium",
  },
  sidekick: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
};
async function fixture() {
  await mkdir("D:/Apps/TwoCode/qa", { recursive: true });
  const root = await mkdtemp("D:/Apps/TwoCode/qa/combinations-unit-");
  await writeFile(join(root, "preferences.json"), JSON.stringify(base));
  return { root, store: new JsonPreferences(root) };
}
test("旧默认无损迁移，多套命名、改名、默认切换和重开一致", async () => {
  const { root, store } = await fixture();
  let view = await store.combinations();
  assert.equal(view.items.length, 1);
  assert.deepEqual(view.items[0]!.preferences, base);
  view = await store.saveCombination({
    revision: view.revision,
    id: view.defaultId!,
    name: "日常协作",
  });
  const fast = { ...base, dual: false };
  view = await store.saveCombination({
    revision: view.revision,
    name: "快速处理",
    preferences: fast,
  });
  const id = view.items[1]!.id;
  assert.deepEqual(await store.read(), base, "保存组合不能改变默认值");
  view = await store.defaultCombination({ revision: view.revision, id });
  assert.deepEqual(await store.read(), fast);
  view = await store.saveCombination({ revision: view.revision, id, name: "轻量任务" });
  assert.deepEqual(await store.read(), fast);
  const updated = { ...fast, mode: "plan" as const };
  view = await store.saveCombination({
    revision: view.revision,
    id,
    name: "轻量任务",
    preferences: updated,
  });
  assert.deepEqual(await store.read(), updated);
  const reopened = new JsonPreferences(root);
  assert.deepEqual(await reopened.combinations(), view);
  assert.deepEqual(await reopened.read(), updated);
  await assert.rejects(
    store.saveCombination({ revision: view.revision, name: "日常协作", preferences: base }),
    /同名/,
  );
  await store.write(base);
  assert.equal((await store.combinations()).items.length, 2, "旧默认API不能擦掉组合库");
  store.dispose();
  reopened.dispose();
});
test("第11套被明确拒绝且不写入，删除后可保存；默认删除原子切换", async () => {
  const { root, store } = await fixture();
  let view = await store.combinations();
  for (let i = 2; i <= 10; i++)
    view = await store.saveCombination({
      revision: view.revision,
      name: `组合${i}`,
      preferences: base,
    });
  const before = await readFile(join(root, "preferences.json"), "utf8");
  await assert.rejects(
    store.saveCombination({ revision: view.revision, name: "第11套", preferences: base }),
    /已保存10套组合，请先删除多余的组合/,
  );
  assert.equal(await readFile(join(root, "preferences.json"), "utf8"), before);
  view = await store.removeCombination({ revision: view.revision, id: view.defaultId! });
  assert.equal(view.defaultId, view.items[0]!.id);
  assert.deepEqual(await store.read(), view.items[0]!.preferences);
  view = await store.saveCombination({
    revision: view.revision,
    name: "第11套",
    preferences: base,
  });
  assert.equal(view.items.length, 10);
  while (view.items.length > 1)
    view = await store.removeCombination({ revision: view.revision, id: view.items.at(-1)!.id });
  await assert.rejects(
    store.removeCombination({ revision: view.revision, id: view.items[0]!.id }),
    /至少保留/,
  );
  store.dispose();
});
test("跨实例并发保存不覆盖，旧revision必须拒绝", async () => {
  const { root, store } = await fixture();
  const other = new JsonPreferences(root),
    view = await store.combinations();
  const results = await Promise.allSettled([
    store.saveCombination({ revision: view.revision, name: "A", preferences: base }),
    other.saveCombination({ revision: view.revision, name: "B", preferences: base }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await store.combinations()).items.length, 2);
  await assert.rejects(
    store.defaultCombination({ revision: view.revision, id: view.defaultId! }),
    /其他窗口更新/,
  );
  store.dispose();
  other.dispose();
});
