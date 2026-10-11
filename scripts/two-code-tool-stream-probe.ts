import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { StepCodeAdapter } from "../packages/services/src/two-code/adapters/step.js";
import type { EngineEvent } from "../packages/services/src/two-code/app/ports.js";
const root = await fs.mkdtemp("D:/Apps/TwoCode/qa/tool-stream-probe-");
const events: EngineEvent[] = [];
const contents = `<svg xmlns="http://www.w3.org/2000/svg"><!--${"fixture ".repeat(200)}--></svg>`;
let count = 0;
const server = createServer(async (req, res) => {
  for await (const _part of req) {
    /* Drain fixture request. */
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (delta: unknown, finish_reason: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({ id: `fixture-${count}`, model: "step-5-preview", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  if (count++ === 0) {
    send({ role: "assistant", content: "我来写入这个测试文件。" });
    send({
      tool_calls: [
        {
          index: 0,
          id: "fixture-call",
          type: "function",
          function: { name: "write_file", arguments: "" },
        },
      ],
    });
    const raw = JSON.stringify({ path: "probe.svg", content: contents });
    for (let i = 0; i < raw.length; i += 300) {
      send({ tool_calls: [{ index: 0, function: { arguments: raw.slice(i, i + 300) } }] });
      await new Promise((r) => setTimeout(r, 300));
    }
    send({}, "tool_calls");
  } else {
    send({ role: "assistant", content: "OK" });
    send({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("port");
const baseUrl = `http://127.0.0.1:${address.port}/v1`,
  adapter = new StepCodeAdapter();
let raw = "";
const parse = Reflect.get(adapter, "parse");
Reflect.set(adapter, "parse", function (chunk: string) {
  raw += chunk;
  return parse.call(adapter, chunk);
});
try {
  await adapter.run({
    role: "lead",
    cwd: root,
    sessionDir: `${root}/session`,
    selection: { harness: "step-code", provider: "step-plan", model: "step-5-preview" },
    connection: {
      baseUrl,
      apiKey: "fixture",
      api: "openai-completions",
      providerConfig: {
        baseUrl,
        apiKey: "fixture",
        api: "openai-completions",
        models: [
          {
            id: "step-5-preview",
            reasoning: false,
            input: ["text"],
            contextWindow: 32768,
            maxTokens: 2048,
          },
        ],
      },
    },
    systemPrompt: "fixture",
    prompt: "写测试文件",
    signal: AbortSignal.timeout(30000),
    emit: async (e) => {
      events.push(e);
    },
    permission: async () => true,
  });
  await fs.writeFile(`${root}/events.json`, JSON.stringify(events, null, 2));
  await fs.writeFile(`${root}/native.jsonl`, raw);
  assert.equal(await fs.readFile(`${root}/probe.svg`, "utf8"), contents);
  const input = events.filter((e) => e.kind === "tool_input");
  assert(input.length > 3, "原生输入流未透传");
  assert(input.every((e) => e.toolCallId === "fixture-call"));
  assert.equal(
    JSON.parse(input.at(-1)!.text).preview,
    JSON.stringify({ path: "probe.svg", content: contents }),
  );
  assert(
    events.findIndex((e) => e.kind === "tool_input") < events.findIndex((e) => e.kind === "tool"),
  );
  assert(events.some((e) => e.kind === "tool_end" && e.text === "success"));
  console.log(JSON.stringify({ root, passed: true, updates: input.length }));
} finally {
  await adapter.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
