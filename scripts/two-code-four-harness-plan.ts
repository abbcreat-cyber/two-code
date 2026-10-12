import assert from "node:assert/strict";
import type { EngineSelection } from "../packages/services/src/two-code/contract.js";
export const profiles: Record<string, EngineSelection> = {
  CG: {
    harness: "claude-code",
    provider: "bigmodel-coding-plan",
    model: "glm-5.3",
    thinking: "max",
  },
  CD: { harness: "claude-code", model: "claude-sonnet-4-8", thinking: "high" },
  CS: {
    harness: "claude-code",
    provider: "step-plan",
    model: "step-5-preview",
    thinking: "medium",
  },
  PA: { harness: "pi", provider: "two-code-chatgpt", model: "gpt-6-astra", thinking: "medium" },
  PG: { harness: "pi", provider: "bigmodel-coding-plan", model: "glm-5.3", thinking: "max" },
  PD: { harness: "pi", provider: "ds-tencent", model: "claude-sonnet-4-8", thinking: "high" },
  PS: { harness: "pi", provider: "step-plan", model: "step-5-preview", thinking: "medium" },
  SS: { harness: "step-code", provider: "step-plan", model: "step-5-preview", thinking: "medium" },
  ZG: { harness: "zcode", provider: "bigmodel-api", model: "GLM-5.3", thinking: "max" },
};
const rounds: string[][][] = [];
const ring = [...Object.keys(profiles), "BYE"];
for (let i = 0; i < 9; i++) {
  const pairs: string[][] = [];
  for (let j = 0; j < 5; j++)
    if (ring[j] !== "BYE" && ring[9 - j] !== "BYE") pairs.push([ring[j]!, ring[9 - j]!]);
  rounds.push(pairs);
  ring.splice(1, 0, ring.pop()!);
}
export const directed = [...rounds, ...rounds.map((r) => r.map(([a, b]) => [b!, a!]))];
assert.equal(new Set(directed.flat().map((p) => p.join("-"))).size, 72);
