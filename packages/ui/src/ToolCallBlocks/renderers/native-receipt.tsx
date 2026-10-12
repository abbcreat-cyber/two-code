import { Check, CircleDashed, CircleAlert, FileCode2, Image, Wrench } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ToolLayout } from "../ToolLayout.js";
import type { ToolCallBlockRenderContext } from "../shared.js";

/** 原生适配器目前只提供完成回执；不要把回执伪装成一块终端输出。 */
export function NativeToolReceipt({
  context,
  draft,
}: {
  context: ToolCallBlockRenderContext;
  draft?: string;
}) {
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const { toolCall } = context.toolCallNode;
  const kind = toolCall.kind.toLowerCase();
  const success = toolCall.status === "completed";
  const failed = toolCall.status === "failed";
  const status = success
    ? zh
      ? "已完成"
      : "Completed"
    : failed
      ? zh
        ? "失败"
        : "Failed"
      : toolCall.status === "pending"
        ? zh
          ? "生成参数中"
          : "Preparing input"
        : context.isRunning
          ? zh
            ? "执行中"
            : "Running"
          : zh
            ? "已中断"
            : "Interrupted";
  let formatted = draft ?? "";
  let target = "";
  try {
    const parsed = JSON.parse(formatted);
    formatted = JSON.stringify(parsed, null, 2);
    target =
      [parsed.path, parsed.file_path, parsed.filePath].find((value) => typeof value === "string") ??
      "";
  } catch {
    /* 流式参数尚不完整时保留原始草稿。 */
  }
  const image = /view_?image|image/.test(kind);
  const edit = /edit|write/.test(kind);
  const Icon = image ? Image : edit ? FileCode2 : Wrench;
  const label = image
    ? zh
      ? "查看图片"
      : "View image"
    : edit
      ? zh
        ? "编辑文件"
        : "Edit file"
      : toolCall.kind;
  const detail = failed
    ? context.errorText
    : !success && !context.isRunning && typeof toolCall.output === "string"
      ? toolCall.output
      : undefined;
  return (
    <div data-testid="two-code-native-tool-receipt">
      <ToolLayout
        toolId={toolCall.toolId}
        icon={<Icon className="size-4 text-foreground-subtle" />}
        kindLabel={label}
        primaryText={target ? target.replaceAll("\\", "/").split("/").at(-1) : null}
        title={target || label}
        secondaryText={
          <span
            className={`inline-flex items-center gap-1.5 text-ui-xs ${success ? "text-success" : failed ? "text-destructive" : "text-foreground-subtle"}`}
          >
            {success ? (
              <Check className="size-3" />
            ) : failed ? (
              <CircleAlert className="size-3" />
            ) : (
              <CircleDashed className="size-3" />
            )}
            {status}
          </span>
        }
        isRunning={context.isRunning}
        canToggle={!!formatted || !!detail}
        autoOpen={false}
        forceOpen={false}
        renderContent={() => (
          <div className="ml-1 space-y-2 border-l border-border pl-4">
            {detail ? <p className="text-ui-caption text-destructive">{detail}</p> : null}
            {formatted ? (
              <div className="overflow-hidden rounded-xl border border-border bg-background-alt">
                <div className="border-b border-border px-3 py-2 text-ui-xs text-foreground-subtle">
                  {zh ? "调用参数" : "Parameters"}
                </div>
                <pre
                  data-testid="two-code-tool-draft"
                  className="max-h-60 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-ui-xs text-foreground-subtle"
                >
                  {formatted}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
