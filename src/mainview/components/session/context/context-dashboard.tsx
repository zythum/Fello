import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  useSessionContext,
  useSessionMessages,
  useSessionUsage,
} from "../../../lib/session-selectors";
import type { ContextSnapshot } from "../../../../shared/schema";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContextStats } from "./context-stats";
import { CurrentComposition } from "./current-composition";
import { ContextHistory } from "./context-history";
import { ContextEvents } from "./context-events";
import { ContextBrowser } from "./context-browser";
import { MessageTokens } from "./message-tokens";
import { useSeedContext } from "./use-seed-context";

interface ContextDashboardProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border/70 bg-popover p-3 ${className ?? ""}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </h3>
      {children}
    </section>
  );
}

function UsageStat({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}
      >
        {value.toLocaleString()}
      </span>
    </span>
  );
}

/** 会话上下文洞察面板（对标 dsh-context 的 Context Tab / /context 弹窗） */
export function ContextDashboard({ sessionId, open, onOpenChange }: ContextDashboardProps) {
  const { t } = useTranslation();
  const { timeline, events, latest, windowSize } = useSessionContext(sessionId);
  const { usage, lastTurnUsage } = useSessionUsage(sessionId);
  const messages = useSessionMessages(sessionId) ?? [];
  const [selected, setSelected] = useState<ContextSnapshot | null>(null);
  const [hovered, setHovered] = useState<ContextSnapshot | null>(null);

  // 打开时若 store 中没有数据，从后端一次性拉取时间线（覆盖 reload / 缓存路径）
  useSeedContext(sessionId, open);

  // 切换会话时清空选中/悬停状态
  useEffect(() => {
    setSelected(null);
    setHovered(null);
  }, [sessionId]);

  const handleHover = useCallback((snap: ContextSnapshot | null) => {
    setHovered(snap);
  }, []);
  const handleSelect = useCallback((snap: ContextSnapshot | null) => {
    setSelected(snap);
  }, []);

  const activeSnapshot = selected ?? hovered ?? latest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-full max-w-5xl flex-col gap-0 p-0 overflow-hidden sm:max-w-5xl">
        <DialogTitle className="sr-only">{t("context.title", "Context")}</DialogTitle>

        {/* 头部 */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-4">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground/90">
              {t("context.title", "Context")}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("context.estimated", "estimated tokens")}
            </span>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 overflow-hidden" viewportClassName="px-0 py-0">
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            {/* 统计 */}
            <div className="lg:col-span-2">
              <SectionCard title={t("context.stats.title", "Session stats")}>
                <ContextStats events={events} messages={messages} />
              </SectionCard>
            </div>

            {/* 当前组成（全宽） */}
            <div className="lg:col-span-2">
              <SectionCard title={t("context.composition.title", "Current composition")}>
                <CurrentComposition snapshot={activeSnapshot} windowSize={windowSize} />
                {lastTurnUsage && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-[11px]">
                    <span className="font-medium text-foreground/85">
                      {t("chatHeader.lastTurn", "Last turn")}
                    </span>
                    <UsageStat label={t("chatHeader.input", "Input")} value={lastTurnUsage.inputTokens} />
                    <UsageStat label={t("chatHeader.output", "Output")} value={lastTurnUsage.outputTokens} />
                    <UsageStat label={t("chatHeader.total", "Total")} value={lastTurnUsage.totalTokens} bold />
                    {lastTurnUsage.thoughtTokens != null && (
                      <UsageStat label={t("chatHeader.thought", "Thought")} value={lastTurnUsage.thoughtTokens} />
                    )}
                    {lastTurnUsage.cachedReadTokens != null && (
                      <UsageStat
                        label={t("chatHeader.cacheRead", "Cache read")}
                        value={lastTurnUsage.cachedReadTokens}
                      />
                    )}
                    {usage?.cost && (
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                        {usage.cost.amount} {usage.cost.currency}
                      </span>
                    )}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* 历史 */}
            <SectionCard title={t("context.history.title", "Context history")}>
              <ContextHistory
                timeline={timeline}
                events={events}
                selectedStepId={selected?.stepId ?? null}
                onHover={handleHover}
                onSelect={handleSelect}
              />
            </SectionCard>

            {/* 浏览器 */}
            <SectionCard title={t("context.browser.title", "Context browser")}>
              <ContextBrowser snapshot={activeSnapshot} sessionId={sessionId} />
            </SectionCard>

            {/* 事件 */}
            <SectionCard title={t("context.events.title", "Context events")}>
              <ContextEvents events={events} />
            </SectionCard>

            {/* 消息 token */}
            <SectionCard title={t("context.messages.title", "Messages")}>
              <MessageTokens sessionId={sessionId} />
            </SectionCard>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
