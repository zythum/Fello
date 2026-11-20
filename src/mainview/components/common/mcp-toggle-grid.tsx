import type { McpServerInfo } from "../../../shared/schema";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** 按容器宽度决定列数，并封顶到实际条目数，避免 2 项时被拆成很窄的 4 列。 */
function mcpGridClassName(count: number): string {
  if (count <= 1) return "grid grid-cols-1 gap-1";
  if (count === 2) return "grid grid-cols-1 gap-1 @[20rem]:grid-cols-2";
  if (count === 3) return "grid grid-cols-1 gap-1 @[20rem]:grid-cols-2 @[30rem]:grid-cols-3";
  return "grid grid-cols-1 gap-1 @[20rem]:grid-cols-2 @[30rem]:grid-cols-3 @[42rem]:grid-cols-4";
}

/** MCP 多选网格：参考新建会话 / 会话头部的 MCP 展示，按宽度自适应 2 / 3 / 4 列。 */
export function McpToggleGrid({
  servers,
  selected,
  disabled,
  onToggle,
}: {
  servers: McpServerInfo[];
  selected: string[];
  disabled?: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="@container">
      <div className={mcpGridClassName(servers.length)}>
        {servers.map((server) => {
          const checked = selected.includes(server.id);
          const isDisabled = disabled === true;
          return (
            <div
              key={server.id}
              title={server.id}
              className={cn(
                "flex h-7 items-center justify-between gap-2 rounded border bg-secondary/50 px-2 text-xs transition-colors",
                isDisabled ? "cursor-not-allowed opacity-60" : "cursor-default hover:bg-accent",
              )}
              onClick={() => {
                if (!isDisabled) onToggle(server.id, !checked);
              }}
            >
              <span
                className={cn(
                  "truncate",
                  checked ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {server.id}
              </span>
              <div onClick={(event) => event.stopPropagation()}>
                <Switch
                  size="sm"
                  checked={checked}
                  disabled={isDisabled}
                  onCheckedChange={(next) => onToggle(server.id, next)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
