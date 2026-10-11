import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { claudeConnection, liftToolImages } from "./claude-connection.js";

test("工具图片提升保留配对、文字和图片，不重复附图", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "fixture-pixels" },
  };
  const body = {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "a",
            content: [{ type: "text", text: "result" }, image],
          },
          { type: "tool_result", tool_use_id: "b", content: "other" },
          { type: "text", text: "user" },
        ],
      },
    ],
  };
  liftToolImages(body);
  const once = structuredClone(body);
  assert.equal(body.messages[0]!.content[0]!.tool_use_id, "a");
  assert.equal(body.messages[0]!.content[1]!.tool_use_id, "b");
  assert.deepEqual(body.messages[0]!.content.at(-1), image);
  liftToolImages(body);
  assert.deepEqual(body, once);
});
test("Claude私有视觉通道按原上游路径流式转发，关闭后不可复用", async () => {
  let received: unknown;
  const upstream = createServer(async (req, res) => {
    assert.equal(req.url, "/bridge/v1/messages");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: fixture\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const addr = upstream.address();
  assert(addr && typeof addr !== "string");
  const connection = await claudeConnection({
    baseUrl: `http://127.0.0.1:${addr.port}/bridge`,
    apiKey: "fixture",
    api: "anthropic-messages",
    providerConfig: {},
  });
  try {
    const url = `${connection.env!.ANTHROPIC_BASE_URL}/v1/messages`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "a",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: "image/png", data: "AA==" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    assert.equal(await response.text(), "data: fixture\n\n");
    assert.match(JSON.stringify(received), /该工具的图像结果/);
    await connection.close();
    await assert.rejects(fetch(url));
  } finally {
    await connection.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
