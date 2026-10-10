import test from "node:test";
import assert from "node:assert/strict";
import { probeConnection } from "./connection-probe.js";
import type { PrivateConnection } from "./native-connections.js";

const connection: PrivateConnection = {
  id: "test",
  harness: "pi",
  name: "test",
  provider: "test",
  api: "openai-completions",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test-secret",
  models: [{ id: "model", name: "model" }],
};
test("probes exact model endpoint with credentials and a bounded prompt", async () => {
  const result = await probeConnection(connection, "model", async (url, init) => {
    assert.equal(String(url), "https://example.invalid/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "model");
    assert.equal(body.max_tokens, 32);
    return Response.json({ choices: [{ message: { reasoning_content: "OK" } }] });
  });
  assert.equal(result.ok, true);
});
test("HTTP failures and fake 200 responses never report connected or expose response secrets", async () => {
  for (const response of [
    new Response("test-secret", { status: 401 }),
    Response.json({ ok: true }),
    Response.json({ error: "test-secret" }),
  ]) {
    const result = await probeConnection(connection, "model", async () => response);
    assert.equal(result.ok, false);
    assert(!JSON.stringify(result).includes("test-secret"));
  }
});
test("Anthropic uses v1 messages, token authentication, and validates message content", async () => {
  const result = await probeConnection(
    {
      ...connection,
      api: "anthropic-messages",
      authMode: "token",
      baseUrl: "https://example.invalid",
    },
    "model",
    async (url, init) => {
      assert.equal(String(url), "https://example.invalid/v1/messages");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
      return Response.json({ type: "message", content: [{ type: "text", text: "OK" }] });
    },
  );
  assert.equal(result.ok, true);
});
test("Responses protocol and transport failures have distinct truthful results", async () => {
  const result = await probeConnection(
    { ...connection, api: "openai-responses" },
    "model",
    async (url) => {
      assert.equal(String(url), "https://example.invalid/v1/responses");
      return Response.json({ object: "response", output: [{ type: "message", content: [] }] });
    },
  );
  assert.equal(result.ok, true);
  const failed = await probeConnection(connection, "model", async () => {
    throw new Error("test-secret");
  });
  assert.equal(failed.ok, false);
  assert(!failed.message.includes("test-secret"));
});
