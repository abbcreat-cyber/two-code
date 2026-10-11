import fs from "node:fs/promises";
import path from "node:path";
const root = `D:/Apps/TwoCode/qa/provider-lifecycle-${Date.now()}`;
await fs.mkdir(root, { recursive: true });
process.env.TWO_CODE_HOME = `${root}/data`;
process.env.ZCODE_DATA_BASE_DIR = `${root}/data`;
const { createLocalServices, disposeServiceResourcesAndWait } =
  await import("../packages/services/src/node.js");
for (let i = 0; i < 3; i++) {
  const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: path.resolve("config/provider/zcode-builtin.json"),
  });
  await disposeServiceResourcesAndWait(services);
}
// 给迟到回包一次事件循环处理窗口，进程也必须自然退出而非强杀。
await new Promise((resolve) => setTimeout(resolve, 300));
await fs.writeFile(`${root}/result.json`, JSON.stringify({ root, cycles: 3, completed: true }));
console.log(JSON.stringify({ root, cycles: 3, completed: true }));
