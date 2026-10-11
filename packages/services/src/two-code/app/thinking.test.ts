import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeThinkingSelection,
  selectionThinkingProfile,
  piThinkingMetadata,
} from "../domain/thinking.js";

test("Step-5两种渠道均收录原生低中高档，旧越界值迁到对应边界", () => {
  for (const provider of ["step-api", "step-plan"]) {
    const selection = { harness: "step-code", provider, model: "step-5-preview" };
    assert.deepEqual(selectionThinkingProfile(selection)?.levels, ["low", "medium", "high"]);
    for (const [previous, expected] of [
      [undefined, "medium"],
      ["off", "low"],
      ["disabled", "low"],
      ["none", "low"],
      ["minimal", "low"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "high"],
      ["max", "high"],
      ["ultra", "high"],
    ]) {
      assert.equal(
        normalizeThinkingSelection({ ...selection, thinking: previous }).thinking,
        expected,
      );
    }
  }
  const metadata = piThinkingMetadata("step-5-preview", "Step-5 订阅", "openai-completions");
  assert.equal(metadata.reasoning, true);
  assert.deepEqual(metadata.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  });
});

test("缺省模型和别名按底座默认身份识别真实模型，不猜未知档位", () => {
  const catalog = [
    {
      id: "pi",
      defaultProvider: "proxy",
      defaultModel: "opaque-id",
      models: [
        {
          id: "opaque-id",
          provider: "proxy",
          name: "本机模型",
          realModel: "deepseek-v4.1-flash",
          aliases: ["alias"],
        },
      ],
    },
  ];
  for (const model of [undefined, "opaque-id", "alias"]) {
    const selection = { harness: "pi", provider: "proxy", model, thinking: "medium" };
    assert.equal(normalizeThinkingSelection(selection, catalog).thinking, "high");
  }
  assert.equal(selectionThinkingProfile({ harness: "pi" }, catalog)?.id, "deepseek-v4.1-flash");
  assert.equal(
    selectionThinkingProfile({ harness: "pi", provider: "missing" }, catalog),
    undefined,
  );
  assert.equal(selectionThinkingProfile({ harness: "pi", model: "unknown" }, catalog), undefined);
});
