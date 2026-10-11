import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { EngineRun } from "../app/ports.js";
import { handoffToolDescription, sidekickForbiddenTool } from "../domain/handoffs.js";
import { permissionDenied } from "./permission-feedback.js";

const definitions = [
  {
    name: "sidekick",
    description: handoffToolDescription,
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" }, block: { type: "boolean" } },
      required: ["message"],
    },
  },
  {
    name: "read_sidekick",
    description: "等待并读取本任务副手的真实报告。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_handoff_history",
    description: "按字符位置读取本任务逐字交接账本；返回nextOffset以继续，不从摘要猜测原文。",
    inputSchema: { type: "object", properties: { offset: { type: "integer", minimum: 0 } } },
  },
];
export class ToolBridge {
  private server?: Server;
  private readonly token = randomBytes(32).toString("hex");
  private origin = "";
  constructor(private readonly input: EngineRun) {}
  get config() {
    return { url: `${this.origin}/mcp`, headers: { Authorization: `Bearer ${this.token}` } };
  }
  get environment() {
    return {
      TWO_CODE_TOOL_URL: `${this.origin}/tool`,
      TWO_CODE_TOOL_TOKEN: this.token,
      TWO_CODE_HAS_SIDEKICK: this.input.handoff ? "1" : "0",
      TWO_CODE_HAS_HISTORY: this.input.readHandoffHistory ? "1" : "0",
    };
  }
  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let id: unknown;
      try {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 262144) throw new Error("派工内容过长");
        }
        const data = JSON.parse(body);
        id = data.id;
        let result: unknown;
        if (request.url === "/tool")
          result = { text: await this.invoke(data.name, data.arguments ?? {}) };
        else if (request.url !== "/mcp") {
          response.writeHead(404).end();
          return;
        } else if (data.method === "initialize")
          result = {
            protocolVersion: data.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "two-code", version: "0.1.0" },
          };
        else if (data.method?.startsWith("notifications/")) {
          response.writeHead(202).end();
          return;
        } else if (data.method === "ping") result = {};
        else if (data.method === "tools/list")
          result = {
            tools: definitions.filter((d) =>
              d.name === "read_handoff_history"
                ? !!this.input.readHandoffHistory
                : !!this.input.handoff,
            ),
          };
        else if (data.method === "tools/call") {
          try {
            result = {
              content: [
                {
                  type: "text",
                  text: await this.invoke(data.params.name, data.params.arguments ?? {}),
                },
              ],
            };
          } catch (error) {
            result = { isError: true, content: [{ type: "text", text: String(error) }] };
          }
        } else throw new Error("不支持的桥接命令");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify(request.url === "/mcp" ? { jsonrpc: "2.0", id, result } : result),
        );
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        if (!address || typeof address === "string") {
          reject(new Error("工具桥接端口不可用"));
          return;
        }
        this.origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }
  private invoke(name: string, args: Record<string, unknown>): Promise<string> {
    this.input.signal.throwIfAborted();
    if (name === "permission") {
      if (typeof args.tool !== "string" || typeof args.detail !== "string")
        throw new Error("权限参数无效");
      return this.input
        .permission(args.tool, args.detail)
        .then((allow) =>
          allow
            ? "allow"
            : permissionDenied(this.input, args.tool as string, args.detail as string),
        );
    }
    if (name === "sidekick" && this.input.handoff) {
      if (
        typeof args.message !== "string" ||
        (args.block !== undefined && typeof args.block !== "boolean")
      ) {
        throw new Error("派工参数无效");
      }
      return this.input.handoff(args.message, args.block as boolean | undefined);
    }
    if (name === "read_sidekick" && this.input.readSidekick) return this.input.readSidekick();
    if (name === "read_handoff_history" && this.input.readHandoffHistory)
      return this.input.readHandoffHistory(args.offset as number | undefined);
    throw new Error("当前角色没有该工具");
  }
  async close(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}

export const piToolExtension = `
import { Type } from '@earendil-works/pi-ai';
export default function(pi) {
  const forbidden = ${sidekickForbiddenTool.toString()};
  let editReminder = false;
  pi.registerCommand('two-code-tool-bridge', {description:'Two Code permission and sidekick bridge v1',handler:async()=>{}});
  const nativePowerShell = () => {
    if (process.env.TWO_CODE_ACTOR_ROLE === 'sidekick') pi.setActiveTools(pi.getActiveTools().filter(name => !forbidden(name)));
    if (process.platform !== 'win32') return false;
    const active = pi.getActiveTools();
    if (!active.some(name => ['bash','run_command','powershell'].includes(name)) || !pi.getAllTools().some(tool => tool.name === 'powershell')) return false;
    if (!active.includes('powershell')) pi.setActiveTools([...active,'powershell']);
    return true;
  };
  pi.on('session_start', nativePowerShell);
  pi.on('before_agent_start', (event) => { editReminder = false; return nativePowerShell() ? {systemPrompt:event.systemPrompt+'\\nWindows PowerShell 脚本直接使用原生 powershell 工具，command 填原始脚本，不经 Bash/run_command 套 PowerShell。'} : undefined; });
  pi.on('tool_result', event => {
    if (process.env.TWO_CODE_HAS_SIDEKICK !== '1' || editReminder || event.isError || !['write','edit','write_file','edit_file'].includes(event.toolName)) return;
    editReminder = true;
    return {content:[...(event.content ?? []),{type:'text',text:'协作提醒：实现和验证默认交给唯一副手；仅1–2轮即可完成并确认的微小修改、正确性关键工作和需亲自判断的渲染工作由主手实施。明确用户分工优先；不要为本提醒重做已完成的修改。'}]};
  });
  pi.on('tool_call', async (event) => {
    if (process.env.TWO_CODE_ACTOR_ROLE === 'sidekick' && forbidden(event.toolName)) return {block:true,reason:'[two-code-permission-denied] 此动作属于主手权限，副手应报告需求而非调用'};
    if (event.toolName === 'read_handoff_history') return;
    if (['sidekick','read_sidekick'].includes(event.toolName)) return;
    if (['subagent','agent_send','workflow'].includes(event.toolName)) return {block:true,reason:'[two-code-permission-denied] 请使用Two Code管理的持久副手，不允许递归委派'};
    try {
      const r = await fetch(process.env.TWO_CODE_TOOL_URL, {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.TWO_CODE_TOOL_TOKEN},body:JSON.stringify({name:'permission',arguments:{tool:event.toolName,detail:JSON.stringify(event.input)}})});
      const result = await r.json();
      if (!r.ok || result.text !== 'allow') return {block:true,reason:'[two-code-permission-denied] '+(r.ok && typeof result.text === 'string' ? result.text : 'Two Code权限通道未确认允许此操作')};
    } catch { return {block:true,reason:'[two-code-permission-denied] Two Code权限通道不可用，命令未执行'}; }
  });
  const call = async (name, args, signal) => {
    const r = await fetch(process.env.TWO_CODE_TOOL_URL, { method:'POST', signal, headers:{'content-type':'application/json', authorization:'Bearer '+process.env.TWO_CODE_TOOL_TOKEN}, body:JSON.stringify({name, arguments:args}) });
    const result = await r.json(); if(!r.ok) throw Error(result.error || '派工失败');
    return { content:[{type:'text',text:result.text}], details:{} };
  };
  if (process.env.TWO_CODE_HAS_HISTORY === '1') pi.registerTool({name:'read_handoff_history',label:'交接历史',description:'读取本任务逐字交接历史，按nextOffset翻页；压缩后按需恢复确切原文。',parameters:Type.Object({offset:Type.Optional(Type.Integer({minimum:0}))}),execute:(id,args,signal)=>call('read_handoff_history',args,signal)});
  if (process.env.TWO_CODE_HAS_SIDEKICK !== '1') return;
  pi.registerTool({name:'sidekick',label:'副手',description:${JSON.stringify(handoffToolDescription)},parameters:Type.Object({message:Type.String(),block:Type.Optional(Type.Boolean())}),execute:(id,args,signal)=>call('sidekick',args,signal)});
  pi.registerTool({name:'read_sidekick',label:'副手报告',description:'等待并读取本任务副手的报告。',parameters:Type.Object({}),execute:(id,args,signal)=>call('read_sidekick',args,signal)});
}
`;
export const stepToolExtension = piToolExtension.replace(
  "import { Type } from '@earendil-works/pi-ai';",
  "import { Type } from 'typebox';",
);
