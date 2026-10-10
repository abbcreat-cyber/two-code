import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";

export function ConnectionStatus({
  verified,
  disabled,
  onTest,
}: {
  verified: boolean;
  disabled: boolean;
  onTest(): Promise<{ ok: boolean; message: string }>;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <div className="flex flex-col items-start gap-1.5 py-2">
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ui-xs ${verified ? "bg-success/10 text-success" : "bg-surface text-foreground-subtle"}`}
      >
        {verified && <CheckCircle2 className="size-3" />}
        {verified ? "上游已核验" : "配置名称"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || busy}
        title={disabled ? "请先保存更改" : result?.message}
        className={`gap-1 px-2 ${result ? (result.ok ? "text-success hover:text-success" : "text-destructive hover:text-destructive") : "text-foreground-subtle"}`}
        onClick={async () => {
          setBusy(true);
          try {
            const next = await onTest();
            if (mounted.current) setResult(next);
          } catch {
            if (mounted.current) setResult({ ok: false, message: "测试失败，请刷新设置后重试" });
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : result ? (
          result.ok ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <XCircle className="size-3" />
          )
        ) : null}
        {busy ? "测试中…" : result ? (result.ok ? "已连通" : "无法连通") : "测试连接"}
      </Button>
      {result && (
        <span
          role="status"
          className={`text-ui-xs ${result.ok ? "text-success" : "text-destructive"}`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
