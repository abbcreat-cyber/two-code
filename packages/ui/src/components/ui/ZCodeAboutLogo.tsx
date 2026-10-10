import { cn } from "@/components/lib/utils.js";
import mark from "@/assets/two-code-mark.svg";

/** 保留上游组件接口，展示本分支的独立产品身份。 */
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={mark}
      width={100}
      height={100}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0", className)}
    />
  );
}
export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <span className={cn("shrink-0 text-ui-xl font-semibold tracking-tight", className)}>
      Two Code
    </span>
  );
}
