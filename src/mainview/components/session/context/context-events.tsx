import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextEvent, ContextEventKind } from "../../../../shared/schema";
import { formatTokens } from "./context-utils";
import { cn } from "@/lib/utils";
import { Scissors, FileInput, ArrowLeftRight, Trash2 } from "lucide-react";

interface ContextEventsProps {
  events: ContextEvent[];
}

const KIND_META: Record<ContextEventKind, { icon: typeof Scissors; label: string; color: string }> = {
  compact: { icon: Scissors, label: "context.event.compact", color: "text-amber-500" },
  prune: { icon: Trash2, label: "context.event.prune", color: "text-rose-500" },
  inject: { icon: FileInput, label: "context.event.inject", color: "text-cyan-500" },
  switch: { icon: ArrowLeftRight, label: "context.event.switch", color: "text-violet-500" },
};

const FILTERS: Array<{ value: ContextEventKind | "all"; label: string }> = [
  { value: "all", label: "context.event.all" },
  { value: "compact", label: "context.event.compact" },
  { value: "prune", label: "context.event.prune" },
  { value: "inject", label: "context.event.inject" },
  { value: "switch", label: "context.event.switch" },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}

/** 上下文事件流（compact / prune / inject / switch），带分类筛选 */
export function ContextEvents({ events }: ContextEventsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ContextEventKind | "all">("all");

  const filtered = filter === "all" ? events : events.filter((e) => e.kind === filter);

  if (events.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        {t("context.events.empty", "No context events yet")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              filter === f.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:bg-muted/40",
            )}
          >
            {t(f.label)}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {filtered.map((event) => {
          const meta = KIND_META[event.kind];
          const Icon = meta.icon;
          return (
            <div
              key={event.id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-[11px]"
            >
              <Icon className={cn("size-3.5 shrink-0", meta.color)} />
              <span className="shrink-0 text-foreground/85">{t(meta.label)}</span>
              {event.detail && (
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {event.detail}
                </span>
              )}
              {event.tokens != null && event.tokens !== 0 && (
                <span
                  className={cn(
                    "shrink-0 font-mono tabular-nums",
                    event.tokens < 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {event.tokens < 0 ? "" : "+"}
                  {formatTokens(event.tokens)}
                </span>
              )}
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                {formatTime(event.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
