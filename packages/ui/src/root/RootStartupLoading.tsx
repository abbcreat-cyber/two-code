import type { ReactNode } from "react";
import mark from "@/assets/two-code-mark.png";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 首屏与 React 加载态共用飞船原图，避免接管页面时闪回旧品牌。 */
export function ZCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <img
      src={mark}
      width={96}
      height={96}
      alt=""
      aria-hidden="true"
      className={cn(
        "size-24 shrink-0 rounded-3xl shadow-xl/20",
        animated && "motion-safe:animate-pulse",
      )}
    />
  );
}
