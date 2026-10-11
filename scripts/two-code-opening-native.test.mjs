import fs from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { StepCodeAdapter } from "../packages/services/src/two-code/adapters/step.js";

for (const scenario of ["normal", "optout", "cancel", "silent"])
  test(`Step原生开场：${scenario}`, { timeout: 35000 }, async () => {
    const root = await fs.mkdtemp("D:/Apps/TwoCode/qa/opening-native-");
    await fs.writeFile(`${root}/marker.txt`, "17");
    const requests = [],
      events = [];
    const controller = new AbortController();
    let openingSeen;
    const reached = new Promise((resolve) => {
      openingSeen = resolve;
    });
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      requests.push(payload);
      const short = payload.tools?.length === 0 || payload.tools === undefined;
      if (scenario === "cancel" && short) {
        openingSeen();
        return;
      }
      const index = requests.length;
      const tool =
        scenario === "silent" ? !short : scenario === "optout" ? index === 1 : index === 2;
      const content = short
        ? scenario === "silent"
          ? "好的，请稍等。"
          : "我先读取指定文件，核对其中的数字。"
        : "核对结果为17。";
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta, finish = null, usage) =>
        response.write(
          "data: " +
            JSON.stringify({
              id: `r${index}`,
              model: "step-5-preview",
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(usage ? { usage } : {}),
            }) +
            "\n\n",
        );
      if (tool)
        send({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call${index}`,
              type: "function",
              function: {
                name: scenario === "silent" ? "write_file" : "read_file",
                arguments: JSON.stringify(
                  scenario === "silent"
                    ? { path: `${root}/forbidden.txt`, content: "bad" }
                    : { path: `${root}/marker.txt` },
                ),
              },
            },
          ],
        });
      else send({ role: "assistant", content });
      send({}, tool ? "tool_calls" : "stop", {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      });
      response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const adapter = new StepCodeAdapter();
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    let latestUsage;
    try {
      const promise = adapter.run({
        role: "lead",
        cwd: root,
        sessionDir: `${root}/session`,
        mode: "edit",
        selection: {
          harness: "step-code",
          provider: "step-plan",
          model: "step-5-preview",
          thinking: "high",
        },
        connection: {
          baseUrl,
          apiKey: "local-fixture",
          api: "openai-completions",
          providerConfig: {
            baseUrl,
            apiKey: "local-fixture",
            api: "openai-completions",
            models: [
              { id: "step-5-preview", reasoning: true, contextWindow: 32768, maxTokens: 2048 },
            ],
          },
        },
        systemPrompt: "中文回复。",
        prompt:
          `读取文件${root}/marker.txt` + (scenario === "optout" ? "，只回答17" : "并核对数字"),
        signal: controller.signal,
        emit: async (event) => {
          events.push(event);
        },
        usage: async (usage) => {
          latestUsage = usage;
        },
        permission: async () => true,
      });
      if (scenario === "cancel") {
        const rejection = assert.rejects(promise);
        await reached;
        controller.abort();
        await rejection;
        assert.equal(requests.length, 1);
      } else if (scenario === "silent") {
        await assert.rejects(promise);
        assert.equal(requests.length, 3);
      assert.equal(events.filter(e => e.notExecuted).length, 2);
        await assert.rejects(fs.access(`${root}/forbidden.txt`));
      } else {
        const result = await promise;
        assert.match(result.text, /17/);
        assert.equal(requests.length, scenario === "normal" ? 3 : 2);
        assert.equal(latestUsage.inputTokens, requests.length * 10);
        if (scenario === "normal") {
          assert.equal(requests[0].max_tokens ?? requests[0].max_completion_tokens, 768);
          assert.equal(requests[0].reasoning_effort, undefined);
          assert.equal(requests[1].reasoning_effort, "high");
          assert(
            events.findIndex((e) => e.kind === "message") <
              events.findIndex((e) => e.kind === "tool"),
          );
        }
      }
      await fs.writeFile(
        `${root}/results.json`,
        JSON.stringify(
          {
            scenario,
            requests: requests.map((r) => ({
              tools: r.tools?.length ?? 0,
              reasoning: r.reasoning_effort,
              maxTokens: r.max_tokens ?? r.max_completion_tokens,
            })),
            events,
            latestUsage,
          },
          null,
          2,
        ),
      );
    } finally {
      controller.abort();
      await adapter.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
