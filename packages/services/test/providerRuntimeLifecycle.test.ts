import test from "node:test";
import assert from "node:assert/strict";
import { ProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { ProviderRuntime } from "../src/model-provider/providerRuntime.js";

function fixture() {
  const config = new ProviderConfigRuntime({
    zcodeBuiltinFilePath: "D:/projects/two-code/config/provider/zcode-builtin.json",
    personalFilePath: "D:/Apps/TwoCode/qa/provider-lifecycle-unused/personal.json",
    watch: false,
    personalPollingIntervalMs: false,
  });
  const runtime = new ProviderRuntime({ configRuntime: config });
  return { config, runtime };
}

test("配置初始化中关闭不再启动已销毁注册表", async () => {
  const { config, runtime } = fixture();
  const gate = Promise.withResolvers<void>();
  let starts = 0;
  config.start = () => gate.promise;
  runtime.registryService.start = async () => {
    starts++;
  };
  const first = runtime.start();
  assert.equal(runtime.start(), first);
  runtime.dispose();
  runtime.dispose();
  gate.resolve();
  await assert.rejects(first, /ProviderRuntime 已 dispose/);
  assert.equal(starts, 0);
});

test("注册表初始化中关闭不能把迟到完成当作就绪", async () => {
  const { config, runtime } = fixture();
  const entered = Promise.withResolvers<void>(),
    gate = Promise.withResolvers<void>();
  config.start = async () => {};
  runtime.registryService.start = async () => {
    entered.resolve();
    await gate.promise;
  };
  const work = runtime.start();
  await entered.promise;
  runtime.dispose();
  gate.resolve();
  await assert.rejects(work, /ProviderRuntime 已 dispose/);
});

test("活实例的真实初始化失败继续拒绝，后续重试仍可正常启动", async () => {
  const { config, runtime } = fixture();
  let attempts = 0,
    starts = 0;
  config.start = async () => {
    if (++attempts === 1) throw Error("fixture-config-invalid");
  };
  runtime.registryService.start = async () => {
    starts++;
  };
  try {
    await assert.rejects(runtime.start(), /fixture-config-invalid/);
    await runtime.start();
    assert.equal(attempts, 2);
    assert.equal(starts, 1);
  } finally {
    runtime.dispose();
  }
});
