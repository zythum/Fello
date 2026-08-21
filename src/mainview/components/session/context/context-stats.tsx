import { useTranslation } from "react-i18next";
import type { ContextEvent } from "../../../../shared/schema";
import type { ChatMessage } from "../../../lib/chat-message";

interface ContextStatsProps {
  events: ContextEvent[];
  messages: ChatMessage[];
}

/** 会话级上下文统计（轮次 / 步骤 / 注入 / 压缩 / 剪枝） */
export function ContextStats({ events, messages }: ContextStatsProps) {
  const { t } = useTranslation();
  const stats: Array<{ label: string; value: number }> = [
    {
      label: t("context.stats.turns", "Turns"),
      value: messages.filter((m) => m.role === "user_message").length,
    },
    {
      label: t("context.stats.steps", "Steps"),
      value: messages.filter((m) => m.role === "tool_call").length,
    },
    {
      label: t("context.stats.injections", "Injections"),
      value: events.filter((e) => e.kind === "inject").length,
    },
    {
      label: t("context.stats.compactions", "Compactions"),
      value: events.filter((e) => e.kind === "compact").length,
    },
    {
      label: t("context.stats.prunes", "Prunes"),
      value: events.filter((e) => e.kind === "prune").length,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-center gap-0.5 rounded-lg border border-border/70 bg-muted/30 px-2 py-2"
        >
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground/90">
            {s.value}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
