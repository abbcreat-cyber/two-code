import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import {
  ModelConfigRules,
  ProviderConfigMap,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";

async function target() {
  await mkdir("D:/Apps/TwoCode/qa/unit-state", { recursive: true });
  return `${await mkdtemp("D:/Apps/TwoCode/qa/unit-state/provider-close-")}/personal.json`;
}
for (const outcome of ["reject", "resolve"] as const) {
  test(`关闭后迟到的legacy导入${outcome}不会触发恢复或写盘`, async () => {
    const filePath = await target();
    const entered = Promise.withResolvers<void>(),
      gate = Promise.withResolvers<ProviderConfigLayerUpdate | null>();
    let recoveries = 0;
    const repo = new NodePersonalProviderConfigRepository({
      filePath,
      pollingIntervalMs: false,
      importLegacy: () => {
        entered.resolve();
        return gate.promise;
      },
      onRecovery: () => {
        recoveries++;
      },
    });
    const work = repo.read();
    await entered.promise;
    repo.dispose();
    if (outcome === "reject") gate.reject(Error("source disposed"));
    else
      gate.resolve({
        providers: ProviderConfigMap.empty(),
        models: ModelConfigRules.empty(),
        providerOrder: [],
      });
    await assert.rejects(work, /已 dispose/);
    assert.equal(recoveries, 0);
    await assert.rejects(access(filePath));
  });
}
test("活仓库坏文件仍报告恢复且不覆盖原始文件", async () => {
  const filePath = await target();
  await writeFile(filePath, "broken-json");
  let recoveries = 0;
  const repo = new NodePersonalProviderConfigRepository({
    filePath,
    pollingIntervalMs: false,
    onRecovery: () => {
      recoveries++;
    },
  });
  try {
    await repo.read();
    assert.equal(recoveries, 1);
    assert.equal(await readFile(filePath, "utf8"), "broken-json");
  } finally {
    repo.dispose();
  }
});
