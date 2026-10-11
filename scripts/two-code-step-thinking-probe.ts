import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { StepCodeAdapter } from "../packages/services/src/two-code/adapters/step.js";
import { TwoCodeConnections } from "../packages/services/src/two-code/adapters/connections.js";
import { newTask } from "../packages/services/src/two-code/domain/task.js";
const root = await fs.mkdtemp("D:/Apps/TwoCode/qa/step-thinking-wire-");
let payload: Record<string, unknown> = {};
const server = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  payload = JSON.parse(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({ id: "fixture", model: "step-5-preview", choices: [{ index: 0, delta: { role: "assistant", content: "THINKING_OK" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("port");
const baseUrl = `http://127.0.0.1:${address.port}/v1`;
const connections = new TwoCodeConnections(root, async () =>
  ["step-api", "step-plan"].map((provider) => ({
    id: provider,
    harness: "step-code",
    provider,
    name: provider,
    baseUrl,
    apiKey: "fixture",
    api: "openai-completions",
    models: [{ id: "step-5-preview", name: "Step-5", reasoning: true }],
  })),
);
const results: unknown[] = [];
try {
  for (const provider of ["step-api", "step-plan"]) {
    let sessionId: string | undefined;
    for (const thinking of ["high", "low", "medium"]) {
      const selection = {
        harness: "step-code" as const,
        provider,
        model: "step-5-preview",
        thinking,
      };
      const task = newTask(
        "fixture",
        { workspacePath: root, dual: false, lead: selection, sidekick: selection },
        "now",
      );
      const adapter = new StepCodeAdapter();
      const states: unknown[] = [];
      const request = Reflect.get(adapter, "request");
      Reflect.set(adapter, "request", async function (type: string, values: unknown) {
        const result = await request.call(adapter, type, values);
        if (type === "get_state")
          states.push({
            model: result.model?.id,
            provider: result.model?.provider,
            thinking: result.thinkingLevel,
          });
        return result;
      });
      try {
        const report = await adapter.run({
          role: "lead",
          cwd: root,
          sessionDir: `${root}/${provider}`,
          sessionId,
          selection,
          connection: (await connections.freeze(task)).lead,
          systemPrompt: "fixture",
          prompt: "只回复THINKING_OK",
          signal: AbortSignal.timeout(20000),
          permission: async () => false,
          emit: async () => {},
        });
        const row = {
          provider,
          thinking,
          states,
          effort: payload.reasoning_effort,
          toggle: payload.thinking,
          resumed: !!sessionId,
          sameSession: !sessionId || sessionId === report.sessionId,
        };
        results.push(row);
        await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
        assert.equal(payload.reasoning_effort, thinking, JSON.stringify(row));
        assert(row.sameSession);
        sessionId = report.sessionId;
      } finally {
        await adapter.close();
      }
    }
  }
  console.log(JSON.stringify({ root, passed: true, results }));
} finally {
  connections.dispose();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
