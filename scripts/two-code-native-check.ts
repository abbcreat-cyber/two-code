import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = `D:/Apps/TwoCode/qa/native-${Date.now()}`;
await fs.mkdir(path.join(root, "workspace"), { recursive: true });
process.env.TWO_CODE_HOME = path.join(root, "data");
process.env.ZCODE_DATA_BASE_DIR = path.join(root, "data");
process.env.ZCODE_HOME = path.join(root, "data/.zcode");
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
const { IProviderSettingsService, ITwoCodeService } =
  await import("../packages/services/src/index.js");
const repo = path.resolve(import.meta.dirname, "..");
const services = createLocalServices({
  zcodeBuiltinProviderConfigFilePath: path.join(repo, "config/provider/zcode-builtin.json"),
  zcodeAgentCommandResolver: () => ({
    command: process.execPath,
    args: [
      path.join(repo, "packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs"),
      "app-server",
      "--stdio",
    ],
    env: { ZCODE_HOME: process.env.ZCODE_HOME! },
  }),
});
try {
  // 只在独立QA配置中复用本机已授权的腾讯网关；不打印认证字段。
  const pi = JSON.parse(await fs.readFile(path.join(homedir(), ".pi/agent/models.json"), "utf8"))
    .providers["ds-tencent"];
  const providers = services.get(IProviderSettingsService);
  const { providerId } = await providers.createPersonalProvider({
    providerName: "Two Code QA",
    initialConfig: {
      access: { type: "api-key", apiKey: pi.apiKey },
      api: { type: "anthropic-messages", baseUrl: pi.baseUrl },
    },
  });
  await providers.addPersonalModel(
    providerId,
    "claude-sonnet-4-8",
    {
      enabled: true,
      properties: {
        requiresMfjsToolSchema: false,
        contextWindow: 200000,
        inputFormat: {
          supportsText: true,
          supportsImage: false,
          supportsVideo: false,
          supportsAudio: false,
          supportsPdf: false,
        },
        outputFormat: { supportsText: true },
        supportsToolCall: true,
        supportsJsonSchemaOutput: false,
        supportsNativeWebSearch: false,
        supportsMidConversationSystem: false,
      },
    },
    true,
  );
  const service = services.get(ITwoCodeService);
  const task = await service.create({
    workspacePath: path.join(root, "workspace"),
    dual: false,
    lead: {
      harness: "zcode",
      provider: providerId,
      model: "claude-sonnet-4-8",
      thinking: "enabled",
    },
    sidekick: { harness: "pi" },
  });
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "原生脚手架验收，不调用任何工具。只回复：原生通路42",
  });
  const deadline = Date.now() + 120000;
  while (true) {
    const state = await service.read(task.id);
    if (state.status !== "running") {
      await fs.writeFile(path.join(root, "result.json"), JSON.stringify(state, null, 2));
      assert.equal(state.status, "completed", state.error);
      assert.match(state.lead.lastReport ?? "", /原生通路42/);
      assert(
        state.events.some((e) => e.kind === "reasoning" && e.text.length > 0),
        "ZCode reasoning events missing",
      );
      console.log(JSON.stringify({ nativePassed: true, root, session: state.lead.sessionId }));
      break;
    }
    if (Date.now() > deadline) {
      await service.cancel(task.id);
      throw new Error("Native acceptance timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const previous = await service.read(task.id);
  assert(previous.usage?.length && previous.usage[0]!.outputTokens > 0);
  await service.configure({
    taskId: task.id,
    preferences: {
      dual: false,
      mode: "edit",
      lead: task.lead.selection,
      sidekick: task.sidekick.selection,
    },
  });
  await service.submit({
    taskId: task.id,
    requestId: randomUUID(),
    text: "权限模式已切换为自动编辑。只用写文件工具创建native-mode.txt，内容恰为NATIVE_MODE_OK；不调用shell、联网或其他工具。然后复述上次你的回复。",
  });
  const followupDeadline = Date.now() + 90000;
  while ((await service.read(task.id)).status === "running") {
    if (Date.now() > followupDeadline) {
      await service.cancel(task.id);
      throw new Error("Native followup timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const followup = await service.read(task.id);
  assert.equal(followup.status, "completed", followup.error);
  assert.equal(followup.lead.sessionId, previous.lead.sessionId);
  assert.match(followup.lead.lastReport ?? "", /原生通路42/);
  assert.equal(
    await fs.readFile(path.join(root, "workspace/native-mode.txt"), "utf8"),
    "NATIVE_MODE_OK",
  );
  assert.equal(followup.usage?.length, 2);
  await fs.writeFile(path.join(root, "followup.json"), JSON.stringify(followup, null, 2));
  console.log(JSON.stringify({ nativeFollowupPassed: true, root }));
} finally {
  await disposeServiceResourcesAndWait(services);
}
