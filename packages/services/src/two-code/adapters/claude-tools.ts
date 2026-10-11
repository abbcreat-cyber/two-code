import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { EngineRun } from "../app/ports.js";
import { handoffToolDescription } from "../domain/handoffs.js";
import { viewImage, visionDescription } from "./vision.js";

export function claudeTools(input: EngineRun) {
  return [
    tool("view_image", visionDescription, { path: z.string().min(1) }, ({ path }) =>
      viewImage(input, path),
    ),
    ...(input.handoff
      ? [
          tool(
            "sidekick",
            handoffToolDescription,
            { message: z.string().min(1), block: z.boolean().optional() },
            async ({ message, block }) => ({
              content: [{ type: "text" as const, text: await input.handoff!(message, block) }],
            }),
          ),
          tool("read_sidekick", "等待并读取副手报告。", {}, async () => ({
            content: [{ type: "text" as const, text: await input.readSidekick!() }],
          })),
        ]
      : []),
    ...(input.readHandoffHistory
      ? [
          tool(
            "read_handoff_history",
            "逐字读取本任务交接历史，按nextOffset翻页，不依赖摘要猜测原文。",
            { offset: z.number().int().nonnegative().optional() },
            async ({ offset }) => ({
              content: [{ type: "text" as const, text: await input.readHandoffHistory!(offset) }],
            }),
          ),
        ]
      : []),
  ];
}
