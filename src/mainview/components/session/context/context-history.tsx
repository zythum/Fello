import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextEvent, ContextSnapshot } from "../../../../shared/schema";
import {
  CONTEXT_CATEGORIES,
  formatDelta,
  formatTokens,
  toPercent,
} from "./context-utils";
import { cn } from "@/lib/utils";
import { Scissors, Trash2 } from "lucide-react";

interface ContextHistoryProps {
  timeline: ContextSnapshot[];
  events: ContextEvent[];
  selectedStepId: string | null;
  onHover: (snapshot: ContextSnapshot | null) => void;
  onSelect: (snapshot: ContextSnapshot | null) => void;
}

type Granularity = "step" | "turn";

interface HistoryItem {
  id: string;
  label: string;
  composition: ContextSnapshot["composition"];
  deltas: ContextSnapshot["deltas"];
  usage: ContextSnapshot["usage"];
  timestamp: number;
  stepIds: string[];
  markers: Array<"compact" | "prune">;
}

function aggregateByTurn(timeline: ContextSnapshot[]): HistoryItem[] {
  const turns = new Map<string, ContextSnapshot[]>();
  for (const snap of timeline) {
    const list = turns.get(snap.turnId);
    if (list) list.push(snap);
    else turns.set(snap.turnId, [snap]);
  }
  const result: HistoryItem[] = [];
  let turnOrdinal = 0;
  for (const [, snaps] of turns) {
    const comp = snaps[0].composition;
    const sum = { ...comp, total: 0 };
    for (const s of snaps) {
      sum.system += s.composition.system;
      sum.tools += s.composition.tools;
      sum.user += s.composition.user;
      sum.assistant += s.composition.assistant;
      sum.toolResults += s.composition.toolResults;
      sum.injections += s.composition.injections;
      sum.total += s.composition.total;
    }
    const last = snaps[snaps.length - 1];
    result.push({
      id: snaps[0].turnId,
      label: `T${turnOrdinal++}`,
      composition: sum,
      deltas: last.deltas,
      usage: last.usage,
      timestamp: snaps[0].timestamp,
      stepIds: snaps.map((s) => s.stepId),
      markers: [],
    });
  }
  return result;
}

function byStep(timeline: ContextSnapshot[]): HistoryItem[] {
  return timeline.map((s) => ({
    id: s.stepId,
    label: `#${s.index}`,
    composition: s.composition,
    deltas: s.deltas,
    usage: s.usage,
    timestamp: s.timestamp,
    stepIds: [s.stepId],
    markers: [],
  }));
}

/** 每步骤/回合的堆叠条历史：hover 预览、click pin、类别 Δ、压缩标记 */
export function ContextHistory({
  timeline,
  events,
  selectedStepId,
  onHover,
  onSelect,
}: ContextHistoryProps) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<Granularity>("step");
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);

  const items = useMemo(() => {
    const list = granularity === "turn" ? aggregateByTurn(timeline) : byStep(timeline);
    // 标记 step 索引处的事件
    const eventByStep = new Map<number, Array<"compact" | "prune">>();
    for (const e of events) {
      if (e.kind !== "compact" && e.kind !== "prune") continue;
      if (e.stepIndex == null) continue;
      const arr = eventByStep.get(e.stepIndex) ?? [];
      arr.push(e.kind);
      eventByStep.set(e.stepIndex, arr);
    }
    return list.map((item) => ({
      ...item,
      markers: item.stepIds
        .flatMap((stepId) => {
          const snap = timeline.find((s) => s.stepId === stepId);
          return snap ? eventByStep.get(snap.index) ?? [] : [];
        })
        .filter((v, i, a) => a.indexOf(v) === i),
    }));
  }, [timeline, events, granularity]);

  if (timeline.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        {t("context.history.empty", "No history yet")}
      </div>
    );
  }

  const windowSize = timeline[timeline.length - 1]?.composition.windowSize ?? 0;
  const anyHovered = hoveredStepId != null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["step", "turn"] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                granularity === g
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t(`context.history.${g}`)}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground/70">
          {t("context.history.hint", "hover to preview · click to pin")}
        </span>
      </div>

      <div className="space-y-1">
        {items.map((item) => {
          const isSelected = selectedStepId != null && item.stepIds.includes(selectedStepId);
          const isHovered = hoveredStepId != null && item.stepIds.includes(hoveredStepId);
          const active = isSelected || isHovered;

          return (
            <div
              key={item.id}
              onMouseEnter={() => {
                setHoveredStepId(item.stepIds[item.stepIds.length - 1] ?? null);
                const snap = timeline.find((s) => s.stepId === item.stepIds[item.stepIds.length - 1]);
                onHover(snap ?? null);
              }}
              onMouseLeave={() => {
                setHoveredStepId(null);
                onHover(null);
              }}
              onClick={() => {
                const snap = timeline.find((s) => s.stepId === item.stepIds[item.stepIds.length - 1]);
                onSelect(isSelected ? null : (snap ?? null));
              }}
              className={cn(
                "group cursor-pointer rounded-md border px-2 py-1.5 transition-colors",
                active
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/50 hover:bg-muted/30",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-8 shrink-0 font-mono text-[10px] tabular-nums",
                    isSelected ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {isSelected ? "📌" : item.label}
                </span>
                <div className="relative flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  {CONTEXT_CATEGORIES.map((c) => {
                    const tokens = item.composition[c.key] ?? 0;
                    if (tokens <= 0) return null;
                    return (
                      <div
                        key={c.key}
                        className={`h-full ${c.color}`}
                        style={{ width: `${toPercent(tokens / windowSize)}%` }}
                      />
                    );
                  })}
                  {/* 自动压缩预留带 */}
                  <div className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-foreground/30" style={{ left: "80%" }} />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                  {formatTokens(item.composition.total)}
                </span>
                {/* 事件标记 */}
                <span className="flex shrink-0 gap-0.5">
                  {item.markers.map((m) =>
                    m === "compact" ? (
                      <Scissors key={m} className="size-3 text-amber-500" />
                    ) : (
                      <Trash2 key={m} className="size-3 text-rose-500" />
                    ),
                  )}
                </span>
              </div>

              {/* 类别 Δ */}
              {item.deltas && Object.keys(item.deltas).length > 0 && anyHovered && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {CONTEXT_CATEGORIES.map((c) => {
                    const delta = item.deltas?.[c.key];
                    if (delta == null || delta === 0) return null;
                    return (
                      <span
                        key={c.key}
                        className={cn(
                          "rounded-full px-1.5 py-px font-mono text-[9px] tabular-nums",
                          delta > 0
                            ? "bg-rose-500/10 text-rose-500"
                            : "bg-emerald-500/10 text-emerald-500",
                        )}
                        style={{ borderLeft: `2px solid ${c.hex}` }}
                      >
                        {formatDelta(delta)}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
