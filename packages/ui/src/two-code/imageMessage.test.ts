import test from "node:test";
import assert from "node:assert/strict";
import { imageMessage, projectImageMessage } from "./imageMessage.js";
test("图片引用保留模型可读完整路径，历史使用原生附件而不丢正文", () => {
  const text = imageMessage("看一下", [
    { name: "a.png", path: "D:/中文 空格/a.png", mime: "image/png" },
  ]);
  assert.match(text, /view_image/);
  const row = projectImageMessage(text);
  assert.equal(row.text, "看一下");
  assert.equal(row.attachments?.[0]?.ref, "D:/中文 空格/a.png");
  assert.deepEqual(projectImageMessage(text + "\n不完整JSON"), { text: text + "\n不完整JSON" });
  assert.deepEqual(projectImageMessage("普通用户文字"), { text: "普通用户文字" });
});
