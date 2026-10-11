import fs from "node:fs/promises";
import { createServer } from "node:http";
import { StepCodeAdapter } from "../packages/services/src/two-code/adapters/step.js";
const root = await fs.mkdtemp("D:/Apps/TwoCode/qa/context-probe-");
let payload: any;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  payload = JSON.parse(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    "data: " +
      JSON.stringify({
        id: "fixture",
        model: "step-5-preview",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      }) +
      "\n\ndata: " +
      JSON.stringify({
        id: "fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("port");
const baseUrl = `http://127.0.0.1:${address.port}/v1`,
  adapter = new StepCodeAdapter(),
  abort = new AbortController();
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
            maxTokens: 1024,
          },
        ],
      },
    },
    systemPrompt: "TWO_CODE_CONTEXT_PROBE：主手负责审查。",
    prompt: "只回复OK",
    signal: abort.signal,
    emit: async () => {},
    permission: async () => true,
  });
  const system = payload.messages
    .filter((m: any) => m.role === "system")
    .map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
  await fs.writeFile(`${root}/system.txt`, system);
  console.log(
    JSON.stringify(
      {
        root,
        customPromptPresent: system.includes("TWO_CODE_CONTEXT_PROBE"),
        directoryLines: system
          .split("\n")
          .filter((l: string) =>
            /working directory|工作区|工作目录|connection|instructions\.txt/i.test(l),
          ),
      },
      null,
      2,
    ),
  );
} finally {
  abort.abort();
  await adapter.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
