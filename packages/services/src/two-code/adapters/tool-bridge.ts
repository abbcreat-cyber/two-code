import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { EngineRun } from "../app/ports.js";

const definitions = [
  {
    name: "sidekick",
    description:
      "将明确任务交给唯一持久副手。默认等待；block:false后必须read_sidekick。副手报告需主手核对。",
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
        else if (data.method === "tools/list") result = { tools: definitions };
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
        .then((allow) => (allow ? "allow" : "deny"));
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
  pi.on('tool_call', async (event) => {
    if (['sidekick','read_sidekick'].includes(event.toolName)) return;
    const r = await fetch(process.env.TWO_CODE_TOOL_URL, {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.TWO_CODE_TOOL_TOKEN},body:JSON.stringify({name:'permission',arguments:{tool:event.toolName,detail:JSON.stringify(event.input)}})});
    const result = await r.json();
    if (!r.ok || result.text !== 'allow') return {block:true,reason:'Two Code任务权限模式未允许此操作'};
  });
  if (process.env.TWO_CODE_HAS_SIDEKICK !== '1') return;
  const call = async (name, args, signal) => {
    const r = await fetch(process.env.TWO_CODE_TOOL_URL, { method:'POST', signal, headers:{'content-type':'application/json', authorization:'Bearer '+process.env.TWO_CODE_TOOL_TOKEN}, body:JSON.stringify({name, arguments:args}) });
    const result = await r.json(); if(!r.ok) throw Error(result.error || '派工失败');
    return { content:[{type:'text',text:result.text}], details:{} };
  };
  pi.registerTool({name:'sidekick',label:'副手',description:'派工给唯一持久副手，默认阻塞等待报告。主手须审查证据。',parameters:Type.Object({message:Type.String(),block:Type.Optional(Type.Boolean())}),execute:(id,args,signal)=>call('sidekick',args,signal)});
  pi.registerTool({name:'read_sidekick',label:'副手报告',description:'等待并读取本任务副手的报告。',parameters:Type.Object({}),execute:(id,args,signal)=>call('read_sidekick',args,signal)});
}
`;
