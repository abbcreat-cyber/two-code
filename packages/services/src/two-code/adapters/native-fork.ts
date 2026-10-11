import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { forkSession } from "@anthropic-ai/claude-agent-sdk";
import type { TwoCodeTask, ActorRole } from "../contract.js";

type RecordLine = {
  type?: string;
  id?: string;
  uuid?: string;
  parentId?: string | null;
  timestamp?: string;
  version?: number;
  message?: { role?: string };
} & Record<string, unknown>;
const records = (text: string): RecordLine[] =>
  text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const before = (line: RecordLine, at: string) =>
  typeof line.timestamp === "string" &&
  Number.isFinite(Date.parse(line.timestamp)) &&
  Date.parse(line.timestamp) <= Date.parse(at);

/** v3原生树：只取目标节点的祖先链，不能把旁支/分叉点之后的条目带过去。 */
export function forkPiRecords(text: string, at: string, id: string, parentSession: string): string {
  const lines = records(text),
    header = lines[0];
  if (header?.type !== "session" || header.version !== 3) throw Error("原生会话格式不支持分叉");
  const entries = lines.slice(1).filter((line) => typeof line.id === "string");
  const eligible = entries.filter((line) => before(line, at));
  const leaf = eligible.at(-1);
  if (
    !leaf ||
    !eligible.some((line) => line.type === "message" && line.message?.role === "assistant")
  )
    throw Error("找不到原生回答分叉点");
  const byId = new Map(entries.map((line) => [line.id!, line]));
  const chain: RecordLine[] = [],
    seen = new Set<string>();
  let current: RecordLine | undefined = leaf;
  while (current) {
    if (!current.id || seen.has(current.id) || !before(current, at)) throw Error("原生分叉链无效");
    seen.add(current.id);
    chain.push(current);
    if (current.parentId == null) break;
    current = byId.get(current.parentId);
    if (!current) throw Error("原生分叉链缺少父节点");
  }
  return (
    [{ ...header, id, timestamp: new Date().toISOString(), parentSession }, ...chain.reverse()]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n"
  );
}

async function claudeFile(id: string): Promise<string> {
  if (!/^[a-f\d-]{36}$/i.test(id)) throw Error("Claude会话身份无效");
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const file = join(root, directory.name, `${id}.jsonl`);
    try {
      await readFile(file, "utf8");
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw Error("未找到Claude原生会话，不能以空上下文替代分叉");
}

export async function forkNativeActors(
  task: TwoCodeTask,
  at: string,
  root: string,
): Promise<Partial<Record<ActorRole, string>>> {
  const result: Partial<Record<ActorRole, string>> = {};
  // 先准备并验证两角色边界，再创建文件，避免已知格式错误留下半份会话。
  const sources = await Promise.all(
    (["lead", "sidekick"] as const).map(async (role) => {
      const actor = task[role];
      if (!actor.sessionId) return undefined;
      if (actor.selection.harness === "zcode") throw Error("该原生底座暂不支持双模型分叉");
      const text = await readFile(
        actor.selection.harness === "claude-code"
          ? await claudeFile(actor.sessionId)
          : actor.sessionId,
        "utf8",
      );
      if (
        !records(text).some(
          (line) =>
            before(line, at) && (line.type === "assistant" || line.message?.role === "assistant"),
        )
      ) {
        if (role === "sidekick") return undefined;
        throw Error("分叉点之前没有主手原生上下文");
      }
      if (actor.selection.harness === "claude-code") {
        const last = records(text)
          .filter(
            (line) =>
              before(line, at) && ["user", "assistant"].includes(line.type ?? "") && line.uuid,
          )
          .at(-1);
        if (!last?.uuid) throw Error("Claude分叉点无效");
        return { role, actor, uuid: last.uuid };
      }
      const id = randomUUID();
      return { role, actor, id, text: forkPiRecords(text, at, id, actor.sessionId) };
    }),
  );
  for (const source of sources) {
    if (!source) continue;
    if (source.uuid)
      result[source.role] = (
        await forkSession(source.actor.sessionId!, {
          dir: task.workspacePath,
          upToMessageId: source.uuid,
          title: `${task.title} · 分支`,
        })
      ).sessionId;
    else {
      const directory = join(root, source.role);
      await mkdir(directory, { recursive: true });
      const file = join(directory, `${source.id}.jsonl`);
      await writeFile(file, source.text!, { encoding: "utf8", flag: "wx", mode: 0o600 });
      result[source.role] = file;
    }
  }
  return result;
}
