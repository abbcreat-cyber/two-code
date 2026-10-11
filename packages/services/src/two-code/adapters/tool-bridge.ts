import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { EngineRun } from "../app/ports.js";
import { handoffToolDescription, sidekickForbiddenTool } from "../domain/handoffs.js";
import { permissionDenied } from "./permission-feedback.js";
import { viewImage, visionDescription } from "./vision.js";
import { inspectTextFile, textFactsDescription } from "./text-file-facts.js";

const definitions = [
  {
    name: "check_text_encoding",
    description: textFactsDescription,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "view_image",
    description: visionDescription,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
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
      TWO_CODE_WORKSPACE: this.input.cwd,
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
          result =
            data.name === "view_image"
              ? await viewImage(this.input, data.arguments?.path)
              : { text: await this.invoke(data.name, data.arguments ?? {}) };
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
              d.name === "view_image"
                ? true
                : d.name === "read_handoff_history"
                  ? !!this.input.readHandoffHistory
                  : !!this.input.handoff,
            ),
          };
        else if (data.method === "tools/call") {
          try {
            result =
              data.params.name === "view_image"
                ? await viewImage(this.input, data.params.arguments?.path)
                : {
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
    if (name === "check_text_encoding")
      return inspectTextFile(this.input, args.path as string).then((facts) =>
        JSON.stringify(facts),
      );
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
  let editReminder = false, workspaceReminder = false;
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
  // 用户指定分工必须在动作前提醒；完成后才催派工曾触发主手回滚正确修改再让副手重做。
  pi.on('before_agent_start', (event) => { editReminder = false; workspaceReminder = false; const ps = nativePowerShell(); return {systemPrompt:event.systemPrompt+'\\n工作区事实（执行器提供）：'+JSON.stringify(process.env.TWO_CODE_WORKSPACE)+ '。配置目录、agent目录、session目录不是工作目录。当前文件直接用相对路径，交接同样沿用相对路径；禁止为确认这些已知事实再搜索目录。'+(process.env.TWO_CODE_HAS_SIDEKICK === '1'?'\\n用户明确指定由副手修改文件或执行命令时，必须在主手调用写入/修改/执行工具之前先用sidekick派工；主手只做用户分配的检查，不能因修改很小而替副手先做。':'')+(ps?'\\nWindows PowerShell 脚本直接使用原生 powershell 工具，command 填原始脚本，不经 Bash/run_command 套 PowerShell。':'')}; });
  pi.on('tool_result', event => {
    // 模型曾把已成功读取的相对文件误认成agent目录文件；在首次结果处补齐路径基准。
    if (!workspaceReminder && !event.isError && process.env.TWO_CODE_WORKSPACE && ['read','read_file','find','find_files','ls','list_directory'].includes(event.toolName)) {
      workspaceReminder = true;
      return {content:[...(event.content ?? []),{type:'text',text:'执行器路径事实：未显式指定其他根目录时，本工具的相对路径及查找结果以 '+JSON.stringify(process.env.TWO_CODE_WORKSPACE)+' 为基准；读取成功的相对文件就在这里，不是session/connection/agent目录，无需为确认同一基准再搜索或重读。'}]};
    }
    if (process.env.TWO_CODE_HAS_SIDEKICK !== '1' || editReminder || event.isError || !['write','edit','write_file','edit_file'].includes(event.toolName)) return;
    editReminder = true;
    return {content:[...(event.content ?? []),{type:'text',text:'执行事实：这次文件修改已实际完成。保留已有正确产物，不得仅为了补分工而撤销再让副手重做同一修改；如分工有偏差，应如实说明实际执行者，再安排尚未完成的工作。产物有错或用户明确要求撤销/重做时，仍按要求处理。'}]};
  });
  pi.on('tool_call', async (event) => {
    if (process.env.TWO_CODE_ACTOR_ROLE === 'sidekick' && forbidden(event.toolName)) return {block:true,reason:'[two-code-permission-denied] 此动作属于主手权限，副手应报告需求而非调用'};
    if (['read_handoff_history','view_image','check_text_encoding'].includes(event.toolName)) return;
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
    return { content:result.content ?? [{type:'text',text:result.text}], details:{} };
  };
  pi.registerTool({name:'check_text_encoding',label:'检查文本格式',description:${JSON.stringify(textFactsDescription)},parameters:Type.Object({path:Type.String()}),execute:(id,args,signal)=>call('check_text_encoding',args,signal)});
  pi.registerTool({name:'view_image',label:'查看图片',description:${JSON.stringify("查看本地PNG/JPEG/WebP/GIF/SVG的真实像素。SVG自动内置渲染，无需系统命令或浏览器。视觉验收请直接使用此工具。")},parameters:Type.Object({path:Type.String()}),execute:(id,args,signal)=>call('view_image',args,signal)});
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
