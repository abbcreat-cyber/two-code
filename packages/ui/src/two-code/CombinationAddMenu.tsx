import { Plus, Copy, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu.js";

export function CombinationAddMenu({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose(kind: "save" | "custom"): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="新增组合"
          title="新增组合"
          data-testid="two-code-combination-add"
          disabled={disabled}
        >
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          onSelect={() => onChoose("save")}
          data-testid="two-code-combination-save-current"
          className="items-start gap-3 py-2.5"
        >
          <Copy className="mt-0.5 size-4 text-foreground-subtle" />
          <span className="space-y-0.5">
            <span className="block">保存当前组合</span>
            <span className="block text-ui-xs text-foreground-subtle">沿用当前主手与副手设置</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onChoose("custom")}
          data-testid="two-code-combination-custom"
          className="items-start gap-3 py-2.5"
        >
          <SlidersHorizontal className="mt-0.5 size-4 text-foreground-subtle" />
          <span className="space-y-0.5">
            <span className="block">自定义组合</span>
            <span className="block text-ui-xs text-foreground-subtle">
              单独选择模型，保留当前任务设置
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
