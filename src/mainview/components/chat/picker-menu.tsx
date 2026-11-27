import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface PickerMenuItem {
  /** 选中时回传的值（模型 id / 思考等级 id） */
  id: string;
  /** 展示名；含 `/` 时按前缀做二级分组，二级里会剥掉前缀 */
  name: string;
  description?: string | null;
}

export interface PickerMenuProps {
  items: readonly PickerMenuItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  /** 触发按钮左侧图标（会话/助理分别用 Astroid、Gauge） */
  icon: LucideIcon;
  /** 没有匹配到 currentId 时按钮上的兜底文案（已翻译） */
  fallbackLabel: string;
  align?: "start" | "end";
  /** 覆盖触发按钮样式（宽度等），与内置样式经 twMerge 合并 */
  buttonClassName?: string;
  /** 覆盖下拉面板样式，与内置样式经 twMerge 合并 */
  contentClassName?: string;
  disabled?: boolean;
}

/**
 * 模型 / 思考等级的通用下拉菜单。
 *
 * 会话与个人助理的输入区共用同一份实现，避免两处各写一遍后逐渐漂移
 * （之前助理侧就漏了「二级菜单剥前缀 / 描述 / 分组勾选 / 限高滚动」）。
 *
 * 分组规则：`name` 里第一个 `/` 之前的部分作为分组名（`openai/gpt-4o` → `openai`）；
 * 只有一个分组时退化成平铺列表，不做二级。
 */
export function PickerMenu({
  items,
  currentId,
  onSelect,
  icon: Icon,
  fallbackLabel,
  align = "end",
  buttonClassName,
  contentClassName,
  disabled,
}: PickerMenuProps) {
  const groups = useMemo(() => groupBySlashPrefix(items), [items]);
  const currentName = items.find((item) => item.id === currentId)?.name ?? fallbackLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className={cn(
              "h-7 min-w-16 max-w-48 shrink gap-2 overflow-hidden text-xs text-muted-foreground hover:text-foreground",
              buttonClassName,
            )}
          />
        }
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{currentName}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        className={cn("w-auto! max-w-72 min-w-(--anchor-width)", contentClassName)}
      >
        {groups.size <= 1
          ? items.map((item) => (
              <PickerRow
                key={item.id}
                id={item.id}
                label={item.name}
                description={item.description}
                selected={item.id === currentId}
                onSelect={onSelect}
              />
            ))
          : Array.from(groups.entries()).map(([group, groupItems]) =>
              group ? (
                <DropdownMenuSub key={group}>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Check
                      className={cn(
                        "size-3 shrink-0",
                        groupItems.some((item) => item.id === currentId)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {group}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 min-w-40 overflow-y-auto">
                    {groupItems.map((item) => (
                      <PickerRow
                        key={item.id}
                        id={item.id}
                        // 父级已经显示分组名，条目里不再重复。
                        label={item.name.slice(group.length + 1)}
                        description={item.description}
                        selected={item.id === currentId}
                        onSelect={onSelect}
                      />
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                groupItems.map((item) => (
                  <PickerRow
                    key={item.id}
                    id={item.id}
                    label={item.name}
                    description={item.description}
                    selected={item.id === currentId}
                    onSelect={onSelect}
                  />
                ))
              ),
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerRow({
  id,
  label,
  description,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  description?: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem onClick={() => onSelect(id)} className="gap-2">
      <Check className={cn("size-3 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <div className="flex min-w-0 flex-col gap-0.5 pr-3">
        <span className="truncate">{label}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground/60 line-clamp-2">{description}</span>
        )}
      </div>
    </DropdownMenuItem>
  );
}

/** 按 `name` 的 `/` 前缀分组；无前缀的归到空字符串组。 */
function groupBySlashPrefix(items: readonly PickerMenuItem[]): Map<string, PickerMenuItem[]> {
  const groups = new Map<string, PickerMenuItem[]>();
  for (const item of items) {
    const slashIndex = item.name.indexOf("/");
    const group = slashIndex > 0 ? item.name.slice(0, slashIndex) : "";
    const bucket = groups.get(group);
    if (bucket) bucket.push(item);
    else groups.set(group, [item]);
  }
  return groups;
}
