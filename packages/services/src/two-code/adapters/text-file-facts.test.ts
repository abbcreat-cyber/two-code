import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { inspectTextFile } from "./text-file-facts.js";
test("字节检查区分BOM与混合换行，不回显文件原文", async () => {
  const cwd = await fs.mkdtemp("D:/Apps/TwoCode/qa/text-facts-");
  const input = { cwd, signal: new AbortController().signal, permission: async () => true };
  const bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("私密\r\nB\nC\r")]);
  await fs.writeFile(`${cwd}/文本 空格.txt`, bytes);
  const facts = await inspectTextFile(input, "文本 空格.txt");
  assert.equal(facts.bom, "utf8");
  assert.equal(facts.utf8Valid, true);
  assert.deepEqual(facts.newlines, { lf: 1, crlf: 1, cr: 1 });
  assert(!JSON.stringify(facts).includes("私密"));
  assert(!("sha256" in facts));
  assert(!("bytes" in facts));
  await fs.writeFile(`${cwd}/bad.txt`, Buffer.from([0xc0, 0xaf]));
  const bad = await inspectTextFile(input, "bad.txt");
  assert.equal(bad.utf8Valid, false);
  assert.equal(bad.newlines, null);
  await fs.writeFile(`${cwd}/wide.txt`, Buffer.from([255, 254, 0, 0]));
  assert.equal((await inspectTextFile(input, "wide.txt")).bom, "utf32le");
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    inspectTextFile({ ...input, signal: aborted.signal }, "missing.txt"),
    /abort/i,
  );
  await assert.rejects(
    inspectTextFile({ ...input, permission: async () => false }, "missing.txt"),
    /未获批准/,
  );
  await assert.rejects(inspectTextFile(input, "."), /普通文件/);
  await fs.writeFile(`${cwd}/large.txt`, Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(inspectTextFile(input, "large.txt"), /4MiB/);
});
