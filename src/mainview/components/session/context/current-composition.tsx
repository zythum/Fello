import { useTranslation } from "react-i18next";
import type { ContextSnapshot } from "../../../../shared/schema";
import { CONTEXT_CATEGORIES, formatTokens, toPercent } from "./context-utils";

interface CurrentCompositionProps {
  snapshot: ContextSnapshot | null;
  windowSize: number;
}

/** 自动压缩软上限（对应窗口的 80%） */
const AUTO_COMPACT_RATIO = 0.8;

/** 当前上下文组成：六色堆叠条 + 80% 预留带 + Top-N 工具 schema */
export function CurrentComposition({ snapshot, windowSize }: CurrentCompositionProps) {
  const { t } = useTranslation();

  if (!snapshot || windowSize <= 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        {t("context.empty", "No context data yet")}
      </div>
    );
  }

  const composition = snapshot.composition;
  const usedPct = toPercent(composition.total / windowSize);
  const reservePct = AUTO_COMPACT_RATIO * 100;
  const overReserve = usedPct > reservePct;

  return (
    <div className="space-y-2">
      {/* 条 + 80% 预留带 */}
      <div className="relative">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {CONTEXT_CATEGORIES.map((c) => {
            const tokens = composition[c.key] ?? 0;
            if (tokens <= 0) return null;
            return (
              <div
                key={c.key}
                className={`h-full ${c.color}`}
                style={{ width: `${toPercent(tokens / windowSize)}%` }}
                title={`${c.key}: ${formatTokens(tokens)}`}
              />
            );
          })}
        </div>
        {/* 自动压缩预留带 */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px border-l-2 border-dashed border-foreground/40"
          style={{ left: `${reservePct}%` }}
        />
      </div>

      {/* 占用说明 */}
      <div className="flex justify-between text-[11px] text-muted-foreground/70">
        <span>
          {t("context.used", "Used")}:{" "}
          <span className="font-mono tabular-nums text-foreground/80">
            {formatTokens(composition.total)}
          </span>{" "}
          / {formatTokens(windowSize)}
        </span>
        <span className={overReserve ? "text-amber-500" : ""}>
          {t("context.percentUsed", "{{pct}}% used", {
            pct: usedPct.toFixed(2),
          })}
          {overReserve ? ` · ${t("context.overReserve", "over auto-compact reserve")}` : ""}
        </span>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {CONTEXT_CATEGORIES.map((c) => {
          const tokens = composition[c.key] ?? 0;
          if (tokens <= 0) return null;
          return (
            <div key={c.key} className="flex items-center gap-1 text-[11px]">
              <span className={`size-2 rounded-sm ${c.color}`} />
              <span className="text-muted-foreground">{t(c.i18nKey)}</span>
              <span className="font-mono tabular-nums text-foreground/80">
                {formatTokens(tokens)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Top-5 工具 schema */}
      {snapshot.topToolSchemas && snapshot.topToolSchemas.length > 0 && (
        <div className="space-y-1 border-t border-border/50 pt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("context.topTools", "Top tools by tokens")}
          </div>
          {snapshot.topToolSchemas.map((tool) => (
            <div key={tool.name} className="flex items-center justify-between text-[11px]">
              <span className="truncate font-mono text-muted-foreground">{tool.name}</span>
              <span className="ml-2 shrink-0 font-mono tabular-nums text-foreground/80">
                {formatTokens(tool.tokens)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
