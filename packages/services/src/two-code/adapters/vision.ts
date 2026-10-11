import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import type { EngineRun } from "../app/ports.js";

const MAX_BYTES = 4 * 1024 * 1024;
export const visionDescription =
  "查看本地图片的真实像素，支持PNG/JPEG/WebP/GIF和SVG。SVG由应用内置渲染器转成PNG，不必搜索系统渲染命令。视觉验收必须调用本工具或原生图片读取工具，不能只数源码元素。主副手均可读取同一路径。";
export type VisionContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
function imageMime(bytes: Buffer, filename: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  if (extname(filename).toLowerCase() === ".svg" && /<svg[\s>]/i.test(bytes.toString("utf8")))
    return "image/svg+xml";
  throw new Error("无法识别图片格式，支持PNG/JPEG/WebP/GIF/SVG；不会当作纯文本发送");
}
export async function storeImage(root: string, input: { fileName: string; dataBase64: string }) {
  if (
    typeof input.fileName !== "string" ||
    typeof input.dataBase64 !== "string" ||
    input.dataBase64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)
  )
    throw new Error("图片附件无效或超过4MB");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("图片为空或超过4MB");
  const mime = imageMime(bytes, input.fileName);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const dir = join(root, "images");
  await mkdir(dir, { recursive: true });
  const extension = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  }[mime]!;
  const path = join(dir, hash + extension);
  await writeFile(path, bytes);
  return { path, name: basename(input.fileName), mime };
}
export async function viewImage(
  input: Pick<EngineRun, "cwd" | "sessionDir" | "signal" | "permission">,
  file: string,
): Promise<{ content: VisionContent[] }> {
  input.signal.throwIfAborted();
  if (typeof file !== "string" || !file.trim()) throw new Error("图片路径不能为空");
  const path = resolve(input.cwd, file);
  if (!(await input.permission("view_image", JSON.stringify({ path }))))
    throw new Error("本次图片读取未获批准");
  if ((await stat(path)).size > MAX_BYTES) throw new Error("图片超过4MB，请先缩小图片");
  let bytes = await readFile(path),
    mime = imageMime(bytes, path),
    preview = path;
  if (mime === "image/svg+xml") {
    const svg = bytes.toString("utf8");
    // SVG查看只渲染自身及嵌入像素；不解析实体、不访问外链或本机引用文件。
    const references = [
      ...svg.matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi),
      ...svg.matchAll(/url\(([^)]*)\)/gi),
    ].map((m) => m[1]!.trim().replace(/^["']|["']$/g, ""));
    if (
      /<!DOCTYPE|<!ENTITY/i.test(svg) ||
      references.some((ref) => !ref.startsWith("#") && !ref.startsWith("data:image/"))
    )
      throw new Error("SVG含外部资源引用；请改为内嵌图片或本地定义后再查看");
    const renderer = new Resvg(svg, {
      fitTo: { mode: "width", value: 1400 },
      font: { loadSystemFonts: true },
    });
    if (renderer.width * renderer.height > 4_000_000)
      throw new Error("SVG渲染尺寸过大，请调整viewBox比例");
    bytes = Buffer.from(renderer.render().asPng());
    mime = "image/png";
    const dir = join(input.sessionDir, "visual");
    await mkdir(dir, { recursive: true });
    preview = join(dir, createHash("sha256").update(bytes).digest("hex") + ".png");
    await writeFile(preview, bytes);
  }
  if (bytes.length > MAX_BYTES) throw new Error("渲染结果超过4MB，请缩小图片");
  input.signal.throwIfAborted();
  return {
    content: [
      {
        type: "text",
        text: `已传递图片像素。来源：${path}\n预览：${preview}\n请依据实际画面判断，不以源码或文件名代替视觉结论。`,
      },
      { type: "image", data: bytes.toString("base64"), mimeType: mime },
    ],
  };
}

export async function readStoredImage(root: string, path: string) {
  if (
    typeof path !== "string" ||
    resolve(path) !== resolve(root, "images", basename(path)) ||
    !/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(basename(path))
  )
    throw new Error("不是当前Host的图片附件");
  const result = await viewImage(
    {
      cwd: root,
      sessionDir: join(root, "previews"),
      signal: new AbortController().signal,
      permission: async () => true,
    },
    path,
  );
  const image = result.content.find((p) => p.type === "image");
  if (!image || image.type !== "image") throw new Error("图片预览不可用");
  return { dataBase64: image.data, mime: image.mimeType };
}
