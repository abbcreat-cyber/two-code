// ESM静态依赖加载失败时，Electron默认错误框会隐藏启动原因；在独立目录保留可诊断日志。
const { app, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
import("../out/main/index.js").catch(async (error) => {
  const root = process.env.ZCODE_DESKTOP_USER_DATA_DIR || "D:/Apps/TwoCode/state/electron";
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "startup-error.log"), message, "utf8");
  console.error(message);
  if (process.env.TWO_CODE_BACKGROUND !== "1")
    dialog.showErrorBox("Two Code 启动失败", `启动日志：${path.join(root, "startup-error.log")}`);
  app.exit(1);
});
