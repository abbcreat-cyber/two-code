import type { UserInputRow } from "@zcode/shared/zcode-protocol-v4";

const marker = "\n\n附图（请用view_image读取真实像素；副手需要看图时传递相同路径）：\n";
const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};
export function imageMessage(
  text: string,
  images: ReadonlyArray<{ name: string; path: string; mime: string }>,
): string {
  return images.length
    ? `${text || "请查看所附图片。"}${marker}${images.map(({ name, path, mime }) => JSON.stringify({ name, path, mime })).join("\n")}`
    : text;
}
/** 模型仍获得原始图片引用；历史仅用原版附件卡显示，不显示内部派工说明。 */
export function projectImageMessage(text: string): Pick<UserInputRow, "text" | "attachments"> {
  const at = text.lastIndexOf(marker);
  if (at < 0) return { text };
  try {
    const images = text
      .slice(at + marker.length)
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      !images.length ||
      images.length > 8 ||
      images.some(
        (i) =>
          typeof i.path !== "string" ||
          typeof i.name !== "string" ||
          !/^(?:[A-Za-z]:[\\/]|\/)/.test(i.path) ||
          !/\.(png|jpe?g|webp|gif|svg)$/i.test(i.path),
      )
    )
      return { text };
    return {
      text: text.slice(0, at),
      attachments: images.map((i) => ({
        ref: i.path,
        fileName: i.name,
        mime: mimeTypes[i.path.split(".").at(-1)!.toLowerCase()]!,
        bytes: 0,
      })),
    };
  } catch {
    return { text };
  }
}
