// 从用户已调好的阶跃星辰 1.0.10 原样移植；运行时写入角色私有扩展目录。
export const stepOpeningSources: Record<string, string> = {
  // SHA256 fab1f1d96a1e82451aedd3b7f9b3d68652066a63af8ce3cb94dbde224429b257
  "assistant-text.mjs": `/** 去掉模型在正文中重复泄漏的工具协议。代码示例保留，普通错误说明保留。 */
export function visibleAssistantText(text, { streaming = false, strip = true } = {}) {
  if (!strip) return text;
  const marker = "<tool_call>";
  // 普通正文不需要逐字重建。只有完整标记或流式末尾的未完标记才进入原解析器；
  // 代码块内的标记仍由原规则判断，不能用正则替换破坏示例。
  if (typeof text === "string" && !text.includes(marker)) {
    const tail = streaming ? text.lastIndexOf("<") : -1;
    if (tail < 0 || !marker.startsWith(text.slice(tail))) return text;
  }
  let output = "",
    i = 0,
    code = null;
  while (i < text.length) {
    if (text.startsWith("\`\`\`", i)) {
      code = code === "\`\`\`" ? null : (code ?? "\`\`\`");
      output += "\`\`\`";
      i += 3;
      continue;
    }
    if (text[i] === "\`" && code !== "\`\`\`") {
      code = code === "\`" ? null : "\`";
      output += text[i++];
      continue;
    }
    if (!code && text.startsWith(marker, i)) {
      const end = text.indexOf("</tool_call>", i + marker.length);
      if (end === -1) break;
      i = end + "</tool_call>".length;
      continue;
    }
    if (!code && streaming && text[i] === "<" && marker.startsWith(text.slice(i))) break;
    output += text[i++];
  }
  return output;
}

/** 历史只在同一 response 确有结构化工具行时净化正文，不更改原生账本。 */
export function visibleConversationRows(rows) {
  const toolResponses = new Set(
    rows
      .filter((r) => r.kind === "toolCall" && r.assistantResponseId)
      .map((r) => r.assistantResponseId),
  );
  return rows
    .map((row) =>
      row.kind === "assistantText" && toolResponses.has(row.assistantResponseId)
        ? { ...row, text: visibleAssistantText(row.text ?? "") }
        : row,
    )
    .filter((row) => row.kind !== "assistantText" || row.text?.trim());
}
`,
  // SHA256 4ff4e29056a7e194e419e56225c3eef6c841cb2eec5aeba803cd320f33754b2b
  "assistant-opening-hook.mjs": `import { visibleAssistantText } from "./assistant-text.mjs";

export const OPENING_REQUIRED = "[desktop-opening-required]";
export const OPENING_STOPPED = "[desktop-opening-stopped]";
export const OPENING_TIMING_POLICY = \`<desktop_opening_timing>
对于需要实际执行的任务，第一条对用户可见的正文应尽早说明具体目标和第一步：先依据已知请求做最小必要判断，立即用用户的语言说一两句，再展开详细分析、设计、编码或长工具参数。不要先在思考中完成整份作品、完整代码或全套方案，才补一句“我来做”。第一性原理要求服务于任务，不是开场前必须完成的长篇分析。
开场必须贴合当前任务，让用户知道你将产出什么、首先处理哪个具体部分；不复述空泛流程，不只说“收到/正在处理/请稍等”，不声称尚未执行的操作已经成功。不为满足开场而增加无关工具调用、扫描目录或重复确认。开场之后再充分思考和执行，保持成果质量。简单问答直接回答，明确只要结果或结构化格式时遵从用户。
</desktop_opening_timing>\`;

function requiresOpening(prompt) {
  return !/只(?:给|要|需).{0,6}(?:结果|答案)|(?:仅|只)(?:需|要)?回答|不要.{0,6}(?:过程|说明)|(?:仅|只).{0,5}(?:输出|返回).{0,5}JSON|(?:only|just)\\s+(?:the\\s+)?(?:answer|result|json)/i.test(
    prompt ?? "",
  );
}
export function withOpeningTimingPolicy(systemPrompt, prompt, enabled = true) {
  const base = (systemPrompt ?? "").replace(
    /\\n?<desktop_opening_timing>[\\s\\S]*?<\\/desktop_opening_timing>/g,
    "",
  );
  return enabled && requiresOpening(prompt) ? \`\${base}\\n\${OPENING_TIMING_POLICY}\` : base;
}

export function meaningfulOpening(text) {
  const visible = visibleAssistantText(text).trim();
  const compact = visible.replace(/[^\\p{L}\\p{N}]/gu, "");
  return (
    Boolean(visible) &&
    !/^(?:好的|好|收到|明白|正在处理|请稍等|稍等|我来处理|我会处理|让我想想|我先看看|ok|okay|gotit|onit|workingonit|pleasewait)+$/i.test(
      compact,
    )
  );
}

/** 只准入工具，不创造 user 消息或额外执行器；补正最多一次，避免无限续跑。 */
export function registerAssistantOpeningHook(pi, enabled = () => true) {
  let required = false,
    spoken = false,
    firstBlockedMessage,
    stop = false;
  pi.on("before_agent_start", (event) => {
    required = requiresOpening(event.prompt);
    spoken = false;
    firstBlockedMessage = undefined;
    stop = false;
  });
  pi.on("message_end", (event) => {
    if (event.message?.role !== "assistant") return;
    const text = (event.message.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (meaningfulOpening(text)) spoken = true;
  });
  pi.on("tool_call", (_event, ctx) => {
    if (!enabled() || !required || spoken) return;
    const message = ctx.sessionManager.getLeafId();
    if (firstBlockedMessage === undefined) firstBlockedMessage = message;
    else if (message !== firstBlockedMessage) stop = true;
    return {
      block: true,
      ...(stop ? { terminate: true } : {}),
      reason: stop
        ? \`\${OPENING_STOPPED} 尚未执行工具。模型再次跳过开场说明，本轮停止，不再自动重试。\`
        : \`\${OPENING_REQUIRED} 尚未执行工具。请先用正常 assistant 正文简短说明当前任务的目标和第一步，再重新调用需要的工具。不要调用新的工具来代替这句说明。\`,
    };
  });
}

export function openingDeferral(result) {
  const text =
    typeof result === "string"
      ? result
      : (result?.content ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
  if (text.includes("[desktop-hooks-stopped]"))
    return "工具未执行：内置钩子配置无法读取，本轮已停止。";
  if (text.includes(OPENING_STOPPED)) return "工具未执行：缺少开场说明，本轮已停止。";
  if (text.includes(OPENING_REQUIRED)) return "工具尚未执行，等待补充开场说明。";
  return null;
}
`,
  // SHA256 b4a8f35251618a97bb133f976937a10d1d01241e65e4200cdfcb0f63c430dfe2
  "early-opening-stream.mjs": `import { meaningfulOpening } from "./assistant-opening-hook.mjs";

export function openingTaskText(context) {
  if (!context.systemPrompt?.includes("<desktop_opening_timing>")) return null;
  const message = context.messages.findLast((m) => m.role === "user");
  const text =
    typeof message?.content === "string"
      ? message.content
      : (message?.content ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\\n");
  if (text.startsWith("工作流状态通知：")) return null;
  if (
    !/(?:画|绘制|制作|生成|创建|修改|修复|优化|安装|读取|检查|分析|整理|搜索|查找|测试|实现|构建|开发|写|删除|打开|运行|继续|帮我|\\b(?:build|create|write|fix|debug|implement|review|analy[sz]e|draw|optimi[sz]e|run|test|search|read|open|delete|install|update|continue)\\b)/i.test(
      text,
    )
  )
    return null;
  return text.slice(0, 4000);
}

function addUsage(a, b) {
  const value = { ...a };
  for (const [key, n] of Object.entries(b ?? {})) {
    if (typeof n === "number") value[key] = (Number.isFinite(value[key]) ? value[key] : 0) + n;
    else if (n && typeof n === "object") value[key] = addUsage(value[key], n);
  }
  return value;
}

/** 同一原生 agent 轮次中的有界开场请求；只拼接实际生成的正文，不解析 SSE 或执行工具。 */
export function earlyOpeningStream({
  createStream,
  model,
  context,
  options,
  startOpening,
  startMain,
  timeoutMs = 8000,
}) {
  const output = createStream();
  void (async () => {
    let opening,
      prefix = [],
      published = false;
    const empty = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const merged = (message) => ({
      ...message,
      content: [...prefix, ...message.content],
      usage: addUsage(message.usage, opening?.usage),
    });
    try {
      options.signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("Opening deadline")), timeoutMs);
      let rejectAbort;
      const cancelled = new Promise((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason ?? new Error("Opening cancelled"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
      });
      try {
        opening = await Promise.race([startOpening(controller.signal).result(), cancelled]);
      } catch {
        // 开场最多尝试一次；失败或超时继续原任务，用户取消则在下面直接结束，不能偷偷续跑。
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", rejectAbort);
        options.signal?.removeEventListener("abort", abort);
      }
      options.signal?.throwIfAborted();
      const text = (opening?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim();
      if (
        opening?.stopReason === "stop" &&
        text.length <= 240 &&
        !/\`\`\`|<svg|<tool_call/i.test(text) &&
        meaningfulOpening(text)
      ) {
        prefix = [{ type: "text", text }];
        const partial = { ...empty, content: prefix, usage: opening.usage };
        output.push({ type: "start", partial });
        output.push({ type: "text_start", contentIndex: 0, partial });
        output.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
        output.push({ type: "text_end", contentIndex: 0, content: text, partial });
        published = true;
      }
      const mainContext = prefix.length
        ? {
            ...context,
            systemPrompt:
              context.systemPrompt +
              \`\\n本轮已向用户发出开场说明：\${JSON.stringify(text)}。现在直接继续实际分析和执行，不重复开场；不得把这句计划当成已完成事实。\`,
          }
        : context;
      options.signal?.throwIfAborted();
      for await (const event of startMain(mainContext)) {
        if (event.type === "start" && published) continue;
        if (event.type === "done") {
          output.push({ ...event, message: merged(event.message) });
          return;
        }
        if (event.type === "error") {
          output.push({ ...event, error: merged(event.error) });
          return;
        }
        output.push({
          ...event,
          ...(event.partial ? { partial: merged(event.partial) } : {}),
          ...(event.contentIndex !== undefined
            ? { contentIndex: event.contentIndex + prefix.length }
            : {}),
        });
      }
      throw new Error("Provider stream ended without terminal event");
    } catch (error) {
      const aborted = options.signal?.aborted;
      output.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: {
          ...merged(empty),
          stopReason: aborted ? "aborted" : "error",
          errorMessage: aborted ? "Request cancelled" : error.message,
        },
      });
    }
  })();
  return output;
}
`,
};
