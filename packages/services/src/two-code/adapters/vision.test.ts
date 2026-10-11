import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { viewImage, storeImage, readStoredImage } from "./vision.js";
import { ToolBridge } from "./tool-bridge.js";
test("SVG渲染为原生image块，MCP桥不压成文字，附件引用可以回读", async () => {
  const root = await fs.mkdtemp("D:/Apps/TwoCode/qa/vision-unit-");
  const file = `${root}/图 空格.svg`;
  await fs.writeFile(
    file,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="100" height="60" fill="url( #g )"/></svg>',
  );
  const input = {
    cwd: root,
    sessionDir: `${root}/session`,
    signal: new AbortController().signal,
    selection: { harness: "pi" as const },
    prompt: "",
    systemPrompt: "",
    permission: async () => true,
    emit: async () => {},
  };
  const image = await viewImage(input, file);
  const pixels = image.content[1];
  assert(pixels?.type === "image");
  assert.equal(pixels.mimeType, "image/png");
  const stored = await storeImage(root, { fileName: "a.png", dataBase64: pixels.data });
  assert.equal((await viewImage(input, stored.path)).content[1]?.type, "image");
  assert.equal((await readStoredImage(root, stored.path)).dataBase64, pixels.data);
  await assert.rejects(readStoredImage(root, file), /不是当前Host/);
  const bridge = new ToolBridge(input);
  await bridge.start();
  try {
    const response = await fetch(bridge.config.url, {
      method: "POST",
      headers: { ...bridge.config.headers, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "view_image", arguments: { path: file } },
      }),
    });
    const result = (await response.json()) as {
      result: { content: Array<{ type: string; data?: string }> };
    };
    assert.equal(result.result.content[1]?.type, "image");
    assert.equal(result.result.content[1]?.data, pixels.data);
    await assert.rejects(viewImage({ ...input, permission: async () => false }, file), /未获批准/);
    await fs.writeFile(
      file,
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///secret.png"/></svg>',
    );
    await assert.rejects(viewImage(input, file), /外部资源/);
    await assert.rejects(
      storeImage(root, {
        fileName: "fake.png",
        dataBase64: Buffer.from("not image").toString("base64"),
      }),
      /格式/,
    );
  } finally {
    await bridge.close();
  }
});
