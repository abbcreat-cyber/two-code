import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { EngineRun } from "../app/ports.js";
export const textFactsDescription =
  "仅用于用户要求的编码、BOM、换行验收，或已发现的乱码/行尾问题。只返回UTF-8有效性、BOM、LF/CRLF/独立CR计数，不提供字符码点或业务正确性证明。普通代码修改、内容翻译及业务结果审查不要调用，不对输入做额外预检；同一未变文件已有这些证据就复用。只读、无原文、无shell，限4MiB。";
export async function inspectTextFile(
  input: Pick<EngineRun, "cwd" | "signal" | "permission">,
  file: string,
) {
  input.signal.throwIfAborted();
  if (typeof file !== "string" || !file.trim()) throw Error("文件路径不能为空");
  const path = resolve(input.cwd, file);
  if (!(await input.permission("check_text_encoding", JSON.stringify({ path }))))
    throw Error("文件检查未获批准");
  input.signal.throwIfAborted();
  const handle = await open(path, "r"),
    limit = 4 * 1024 * 1024;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error("只支持普通文件");
    if (stat.size > limit) throw Error("文件超过4MiB");
    // 同一文件句柄有界读取，避免stat后增长导致无限读取；所有事实来自这份字节快照。
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      input.signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > stat.size || count > limit)
      throw Error("文件读取期间增长或超过4MiB，请待写入完成再检查");
    const bytes = buffer.subarray(0, count);
    let utf8Valid = true;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      utf8Valid = false;
    }
    const bom = bytes.subarray(0, 4).equals(Buffer.from([255, 254, 0, 0]))
      ? "utf32le"
      : bytes.subarray(0, 4).equals(Buffer.from([0, 0, 254, 255]))
        ? "utf32be"
        : bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
          ? "utf8"
          : bytes[0] === 255 && bytes[1] === 254
            ? "utf16le"
            : bytes[0] === 254 && bytes[1] === 255
              ? "utf16be"
              : "none";
    const newlines = utf8Valid ? { lf: 0, crlf: 0, cr: 0 } : null;
    if (newlines)
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 13) {
          if (bytes[i + 1] === 10) {
            newlines.crlf++;
            i++;
          } else newlines.cr++;
        } else if (bytes[i] === 10) newlines.lf++;
      }
    input.signal.throwIfAborted();
    return {
      path,
      utf8Valid,
      bom,
      newlines,
    };
  } finally {
    await handle.close();
  }
}
