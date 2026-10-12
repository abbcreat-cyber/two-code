import { Database, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TwoCodeTask } from "@zcode/services";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SessionStatisticsBar } from "@/v4/composer/SessionStatisticsBar.js";
import { projectTwoCodeRoleUsage, projectTwoCodeUsage } from "./usageProjection.js";

const harnessNames = {
  "claude-code": "Claude Code",
  pi: "Pi",
  "step-code": "Step Code",
  zcode: "ZCode",
};

function RoleUsagePanel({ item }: { item: ReturnType<typeof projectTwoCodeRoleUsage>[number] }) {
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const roleName = item.role === "lead" ? (zh ? "主手" : "Lead") : zh ? "副手" : "Sidekick";
  const missing = item.state === "unreported";
  const status =
    item.state === "reported"
      ? zh
        ? "已上报用量"
        : "Reported usage"
      : missing
        ? zh
          ? "未上报"
          : "Not reported"
        : zh
          ? "未调用"
          : "Not invoked";
  const u = item.usage?.cumulative ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const input = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const total = input + u.outputTokens;
  const number = (value: number) => (missing ? "—" : new Intl.NumberFormat(locale).format(value));
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(total);
  const hit = input ? Math.min(100, (u.cacheReadTokens / input) * 100) : 0;
  const accent = item.role === "lead" ? "text-sky-500" : "text-violet-500";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`two-code-${item.role}-usage`}
          aria-label={`${roleName} Token`}
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-ui-caption text-foreground-subtle transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Database className={`size-3.5 ${accent}`} />
          <span>{roleName}</span>
          <span className="tabular-nums text-foreground">{missing ? "—" : compact}</span>
          <span className="text-foreground-subtlest">
            {item.state === "reported" ? "tok" : status}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 rounded-2xl p-5"
        data-testid={`two-code-${item.role}-usage-panel`}
      >
        <div className="flex items-center justify-between gap-3 text-ui-caption">
          <span className="flex items-center gap-2 font-medium">
            <Database className={`size-4 ${accent}`} />
            {roleName} Token
          </span>
          <span className="rounded-md bg-surface px-2 py-1 text-foreground-subtle">{status}</span>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <strong className="text-ui-xl font-semibold tabular-nums" data-testid="role-token-total">
            {number(total)}
          </strong>
          <span className="text-ui-caption text-foreground-subtlest">tokens</span>
        </div>
        <p
          className="mt-1 truncate text-ui-xs text-foreground-subtlest"
          title={item.selection.modelLabel ?? item.selection.model}
        >
          {zh ? "当前配置" : "Current setup"} · {harnessNames[item.selection.harness]} ·{" "}
          {item.selection.modelLabel ?? item.selection.model ?? "默认模型"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            [zh ? "输入合计" : "Total input", input, ArrowDownLeft],
            [zh ? "输出" : "Output", u.outputTokens, ArrowUpRight],
          ].map(([label, value, Icon]) => {
            const MetricIcon = Icon as typeof ArrowDownLeft;
            return (
              <div key={String(label)} className="rounded-xl bg-surface px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <MetricIcon className="size-3" />
                  {String(label)}
                </div>
                <div className="mt-1 text-ui-base font-medium tabular-nums">
                  {number(Number(value))}
                </div>
              </div>
            );
          })}
        </div>
        <dl className="mt-4 space-y-2 text-ui-caption">
          {[
            [zh ? "未缓存输入" : "Uncached input", u.inputTokens],
            [zh ? "缓存读取" : "Cache read", u.cacheReadTokens],
            [zh ? "缓存写入" : "Cache write", u.cacheWriteTokens],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-foreground-subtle">{label}</dt>
              <dd className="tabular-nums">{number(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex justify-between text-ui-xs text-foreground-subtle">
            <span>{zh ? "缓存命中" : "Cache hit"}</span>
            <span>{missing || !input ? "—" : `${Math.round(hit)}%`}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface">
            <div
              className={`h-full rounded-full ${item.role === "lead" ? "bg-sky-500" : "bg-violet-500"}`}
              style={{ width: `${hit}%` }}
            />
          </div>
        </div>
        <p className="mt-3 text-ui-xs text-foreground-subtlest">
          {missing
            ? zh
              ? "已执行，但脚手架尚未返回统计。"
              : "The harness has not reported usage yet."
            : zh
              ? "仅累计本角色收到的回执，运行中可能继续增加。"
              : "Includes reported usage for this role only."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function TwoCodeUsageBar({ task }: { task?: TwoCodeTask }) {
  if (!task) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="two-code-role-usage">
      <SessionStatisticsBar usage={projectTwoCodeUsage(task)} hideTokens />
      {projectTwoCodeRoleUsage(task).map((item) => (
        <RoleUsagePanel key={item.role} item={item} />
      ))}
    </div>
  );
}
