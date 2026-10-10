import assert from "node:assert/strict";
import test from "node:test";
import { chooseModel, modelChoices, sameModel } from "./modelChoices.js";
import type { EngineSelection, HarnessInfo } from "@zcode/services";
test("same model IDs on different connections retain identity and unsupported choices never alter harness", () => {
  const current: EngineSelection = {
    harness: "pi",
    provider: "a",
    model: "same",
    modelLabel: "当前名称",
    thinking: "xhigh",
  };
  const catalog: HarnessInfo[] = [
    {
      id: "pi",
      name: "Pi",
      available: true,
      detail: "",
      models: [
        { id: "same", provider: "a", name: "A" },
        { id: "same", provider: "b", name: "B" },
      ],
    },
    {
      id: "claude-code",
      name: "Claude Code",
      available: true,
      detail: "",
      models: [{ id: "same", name: "C" }],
    },
  ];
  const choices = modelChoices(catalog, current);
  assert.equal(choices.length, 3);
  assert.equal(choices[0]!.name, "当前名称");
  assert.equal(choices[1]!.name, "B");
  assert(!sameModel(current, choices[1]!.selection));
  assert(!sameModel(current, choices[2]!.selection));
  assert.equal(chooseModel(current, choices[1]!.selection).provider, "b");
  assert.equal(chooseModel(current, choices[1]!.selection).thinking, "xhigh");
});
