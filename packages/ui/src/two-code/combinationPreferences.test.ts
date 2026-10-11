import test from "node:test";
import assert from "node:assert/strict";
import type { HarnessInfo, TwoCodePreferences } from "@zcode/services";
import { matchesCombination, normalizeCombination } from "./combinationPreferences.js";
const catalog: HarnessInfo[] = [
  {
    id: "step-code",
    name: "Step Code",
    available: true,
    detail: "",
    models: [{ id: "step-5-preview", name: "Step-5 订阅", provider: "step-plan" }],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    available: true,
    detail: "",
    models: [
      { id: "route", name: "本机模型", realModel: "deepseek-v4.1-flash", aliases: ["sonnet"] },
    ],
  },
];
const old: TwoCodePreferences = {
  dual: true,
  lead: { harness: "step-code", provider: "step-plan", model: "step-5-preview", thinking: "max" },
  sidekick: { harness: "claude-code", model: "sonnet", thinking: "medium" },
};
test("旧组合档位和别名按实际配置匹配，迁移显示不改原对象", () => {
  const next = normalizeCombination(old, catalog);
  assert.equal(next.lead.thinking, "high");
  assert.equal(next.sidekick.thinking, "high");
  assert.equal(next.sidekick.model, "route");
  assert.equal(old.lead.thinking, "max");
  assert(matchesCombination(old, next, catalog));
  assert(
    !matchesCombination(old, { ...next, lead: { ...next.lead, provider: "step-api" } }, catalog),
  );
  assert(!matchesCombination(old, { ...next, lead: { ...next.lead, thinking: "low" } }, catalog));
  assert(
    matchesCombination(
      { ...old, dual: false },
      { ...next, dual: false, sidekick: { harness: "pi" } },
      catalog,
    ),
  );
});
