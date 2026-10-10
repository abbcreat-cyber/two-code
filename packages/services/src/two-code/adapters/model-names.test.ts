import test from "node:test";
import assert from "node:assert/strict";
import { nameForModel, parseModelRoutes, readLocalModelRoutes } from "./model-names.js";

test("gateway route truth wins over compatibility IDs and labels", () => {
  const metadata = parseModelRoutes({
    routes: {
      "claude-sonnet-4-8": {
        model: "deepseek-v4.1-flash",
        label: "wrong alias label",
        secret: "not-exported",
      },
    },
  });
  assert.deepEqual(metadata, { routes: { "claude-sonnet-4-8": { model: "deepseek-v4.1-flash" } } });
  assert.equal(nameForModel("claude-sonnet-4-8", metadata, true).name, "DeepSeek V4.1 Flash");
  const changed = parseModelRoutes({ routes: { "claude-sonnet-4-8": { model: "mimo-v2.6-pro" } } });
  assert.equal(nameForModel("claude-sonnet-4-8", changed, true).name, "MiMo V2.6 Pro");
  assert.equal(nameForModel("trae-model", undefined, true, "TRAE 探针").name, "TRAE 探针");
  assert.equal(nameForModel("gpt-6-astra", undefined, true, "GPT-6 Astra").name, "GPT-6 Astra");
  assert.equal(nameForModel("glm-5.3", undefined, false).name, "GLM-5.3");
});
test("model metadata reader does not probe external API hosts", async () => {
  assert.equal(await readLocalModelRoutes("https://example.invalid/v1"), undefined);
  assert.equal(parseModelRoutes({ routes: { invalid: { model: 42 } } }), undefined);
});
