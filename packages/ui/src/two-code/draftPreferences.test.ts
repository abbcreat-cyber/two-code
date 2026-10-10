import test from "node:test";
import assert from "node:assert/strict";
import {
  readDraftPreferences,
  saveDraftPreferences,
  clearSubmittedDraftPreferences,
} from "./draftPreferences.js";
import type { TwoCodePreferences } from "@zcode/services";
test("draft preferences survive refresh without changing defaults and clear only after their submission", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const defaults: TwoCodePreferences = {
    dual: true,
    lead: { harness: "pi", model: "glm-5.3", thinking: "max" },
    sidekick: { harness: "pi", thinking: "high" },
  };
  const draft = { ...defaults, dual: false };
  saveDraftPreferences(store, "workspace-a", draft);
  assert.equal(readDraftPreferences(store, "workspace-a", defaults).dual, false);
  assert.equal(readDraftPreferences(store, "workspace-b", defaults).dual, true);
  assert.equal(defaults.dual, true);
  saveDraftPreferences(store, "workspace-a", defaults);
  clearSubmittedDraftPreferences(store, "workspace-a", draft);
  assert.notEqual(store.getItem("workspace-a"), null);
  clearSubmittedDraftPreferences(store, "workspace-a", defaults);
  assert.equal(store.getItem("workspace-a"), null);
  store.setItem("workspace-a", "{broken");
  assert.equal(readDraftPreferences(store, "workspace-a", defaults), defaults);
  store.setItem(
    "workspace-a",
    JSON.stringify({ ...draft, lead: { harness: "pi", model: { invalid: true } } }),
  );
  assert.equal(readDraftPreferences(store, "workspace-a", defaults), defaults);
});
