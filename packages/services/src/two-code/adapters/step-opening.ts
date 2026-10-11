import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stepOpeningSources } from "./step-opening-sources.js";
import type { EngineEvent } from "../app/ports.js";

export function openingToolEvent(
  record: Record<string, unknown>,
): { event: EngineEvent; stopped: boolean } | undefined {
  if (!record.isError) return;
  const value = record.result;
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "content" in value && Array.isArray(value.content)
        ? value.content
            .filter((p) => p?.type === "text")
            .map((p) => String(p.text ?? ""))
            .join("")
        : "";
  if (!/\[desktop-opening-(required|stopped)\]/.test(text)) return;
  const stopped = text.includes("[desktop-opening-stopped]");
  return {
    stopped,
    event: {
      kind: "tool",
      toolCallId: String(record.toolCallId),
      notExecuted: true,
      text: stopped ? "工具未执行：缺少开场说明，本轮已停止。" : "工具尚未执行，等待补充开场说明。",
    },
  };
}

/** 沿用阶跃星辰原生provider包装，Two Code只装配当前角色和已冻结的原生连接。 */
export const stepOpeningExtension = `
import { getApiProvider, createAssistantMessageEventStream } from '@step-harness/providers';
import { withOpeningTimingPolicy, registerAssistantOpeningHook } from './assistant-opening-hook.mjs';
import { earlyOpeningStream, openingTaskText } from './early-opening-stream.mjs';
export default function(pi) {
  const enabled = () => process.env.TWO_CODE_ACTOR_ROLE !== 'sidekick';
  let available = false;
  pi.on('before_agent_start', event => {
    available = enabled();
    return { systemPrompt: withOpeningTimingPolicy(event.systemPrompt, event.prompt, enabled()) };
  });
  pi.on('agent_settled', () => { available = false; });
  registerAssistantOpeningHook(pi, enabled);
  pi.on('session_start', (_event, ctx) => {
    const selected = ctx.model;
    if (!enabled() || selected?.api !== 'openai-completions') return;
    const native = getApiProvider(selected.api)?.streamSimple;
    if (typeof native !== 'function') throw Error('Step原生开场stream不可用');
    pi.registerProvider(selected.provider, {
      api: selected.api,
      streamSimple(model, context, options = {}) {
        const task = available ? openingTaskText(context) : null;
        available = false;
        if (!task || !model.reasoning) return native(model, context, options);
        return earlyOpeningStream({
          createStream: createAssistantMessageEventStream, model, context, options,
          startMain: mainContext => native(model, mainContext, options),
          startOpening: signal => native({ ...model, reasoning: false }, {
            systemPrompt: '把提供的任务改写成一句自然、具体的第一人称开场计划，包含目标和第一个动作，使用用户的语言。只输出这句话，不执行任务，不分析实现细节，不声称已完成。',
            messages: [{ role: 'user', content: [{type:'text', text: '待改写的任务：\\n'+task+'\\n\\n直接输出一句开场计划，不完成原任务。'}], timestamp: Date.now() }],
            tools: [],
          }, { ...options, signal, reasoning: undefined, thinkingBudgets: undefined, maxTokens: Math.min(768, model.maxTokens ?? 768) }),
        });
      },
    });
  });
  pi.registerCommand('two-code-step-opening', {description:'Two Code Step opening v1',handler:async()=>{}});
}
`;

export async function writeStepOpeningExtension(sessionDir: string): Promise<string> {
  const root = join(sessionDir, "opening");
  await mkdir(root, { recursive: true });
  await Promise.all(
    Object.entries({ ...stepOpeningSources, "extension.mjs": stepOpeningExtension }).map(
      ([name, source]) => writeFile(join(root, name), source, "utf8"),
    ),
  );
  return join(root, "extension.mjs");
}
