import { useEffect, useRef, useState } from "react";
import type { ITwoCodeService } from "@zcode/services";
import type { ChatComposerPasteEvent } from "@/LexicalChatInput.js";
import { Button } from "@/components/ui/button.js";
import { ImageIcon, X } from "lucide-react";
import { imageMessage } from "@/two-code/imageMessage.js";

type Item = { id: string; path: string; name: string; mime: string; preview?: string };
const load = (key: string): Item[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((i) => typeof i.path === "string" && typeof i.name === "string")
      : [];
  } catch {
    return [];
  }
};
const readData = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
async function thumbnail(data: string): Promise<string> {
  const img = new Image();
  img.src = data;
  await img.decode();
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 120 / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
/** 图片由Host持久保存；草稿仅保留引用和小缩略图，发送仍走原submit。 */
export function useTwoCodeImages(draftKey: string, upload?: ITwoCodeService["importImage"]) {
  const key = `${draftKey}:images`,
    current = useRef(key),
    picker = useRef<HTMLInputElement>(null);
  current.current = key;
  const [items, setItems] = useState(() => load(key)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const uploading = useRef(false);
  useEffect(() => {
    setItems(load(key));
    setError("");
  }, [key]);
  const save = (scope: string, next: Item[]) => {
    localStorage.setItem(scope, JSON.stringify(next));
    if (current.current === scope) setItems(next);
  };
  const add = async (files: File[]) => {
    if (!upload || uploading.current || !files.length) return;
    const scope = key;
    uploading.current = true;
    setBusy(true);
    setError("");
    try {
      if (load(scope).length + files.length > 8) throw Error("最多添加8张图片");
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) throw Error("图片超过4MB，请先缩小");
        const data = await readData(file);
        const saved = await upload({
          fileName: file.name,
          dataBase64: data.slice(data.indexOf(",") + 1),
        });
        const preview =
          saved.mime === "image/svg+xml" ? undefined : await thumbnail(data).catch(() => undefined);
        save(scope, [...load(scope), { id: crypto.randomUUID(), ...saved, preview }]);
      }
    } catch (e) {
      if (current.current === scope) setError(String(e));
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  };
  const input = (
    <input
      ref={picker}
      type="file"
      multiple
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
      className="hidden"
      data-testid="two-code-image-input"
      onChange={(e) => {
        void add(Array.from(e.target.files ?? []));
        e.target.value = "";
      }}
    />
  );
  const chips = (
    <>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2" data-testid="two-code-images">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex max-w-60 items-center gap-2 rounded-lg bg-surface px-2 py-1 text-ui-caption"
            >
              {item.preview ? (
                <img
                  src={item.preview}
                  alt={item.name}
                  className="h-10 w-10 rounded object-contain"
                />
              ) : (
                <ImageIcon size={20} />
              )}
              <span className="truncate">{item.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`移除${item.name}`}
                onClick={() =>
                  save(
                    key,
                    items.filter((_, i) => i !== index),
                  )
                }
              >
                <X size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {busy && <p className="text-ui-caption">正在添加图片…</p>}
      {error && (
        <p role="alert" className="text-ui-caption text-destructive">
          {error}
        </p>
      )}
    </>
  );
  return {
    items,
    busy,
    input,
    chips,
    open: () => picker.current?.click(),
    paste: (event: ChatComposerPasteEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length) {
        event.preventDefault();
        void add(files);
      }
    },
    drop: (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer.files).filter(
        (f) => f.type.startsWith("image/") || /\.svg$/i.test(f.name),
      );
      if (files.length) {
        event.preventDefault();
        event.stopPropagation();
        void add(files);
      }
    },
    compose: (text: string) => imageMessage(text, items),
    clear: (sent: Item[]) => {
      const ids = new Set(sent.map((i) => i.id));
      save(
        key,
        load(key).filter((i) => !ids.has(i.id)),
      );
    },
  };
}
