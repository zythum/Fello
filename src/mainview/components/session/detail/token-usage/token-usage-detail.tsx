import { useEffect, useState, type ComponentType } from "react";
import {
  ChevronDown,
  ChevronRight,
  Gauge,
  Layers,
  MessageSquare,
  Wrench,
  X,
  Zap,
  MessagesSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { request, subscribe, type BackendEvents } from "../../../../backend";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  SessionInfo,
  SessionTokenBreakdown,
  SessionTokenInputComposition,
  SessionTokenPerformance,
  SessionTokenStep,
  SessionTokenToolCall,
  SessionTokenToolsDefinition,
  SessionTokenUsage,
} from "../../../../../shared/schema";

interface TokenUsageDetailProps {
  session: SessionInfo;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TokenUsageDetail({ session, onClose }: TokenUsageDetailProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<SessionTokenUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const load = (silent = false) => {
      if (!silent) setLoading(true);
      request
        .getSessionTokenUsage({ sessionId: session.id })
        .then((res) => {
          if (!cancelled) {
            setRecords(parseTokenUsageRecords(res.records));
          }
        })
        .catch(() => {
          if (!cancelled) setRecords([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    // 首次打开加载
    load();

    // 会话结束（prompt-end）后自动刷新。
    // 注意：prompt-end 在 token-usage.jsonl 写入之前发出，延迟一拍再拉取。
    const handlePromptEnd = (payload: BackendEvents["prompt-end"]) => {
      if (payload.sessionId !== session.id) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!cancelled) load(true); // 静默刷新，避免 loading 闪烁
      }, 500);
    };
    subscribe.on("prompt-end", handlePromptEnd);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      subscribe.off("prompt-end", handlePromptEnd);
    };
  }, [session.id]);

  const liveRecord = createLiveRecord(session.lastTurnUsage, session.updatedAt);
  const displayRecords = mergeLiveRecord(records, liveRecord);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-3 bg-background/95"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex size-4 shrink-0 items-center justify-center">
            <Zap className="size-3.5 text-amber-500/80" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-foreground/60">
              <span className="text-xs font-semibold truncate">
                {t("tokenUsage.title", "Token Usage Breakdown")}
              </span>
              {displayRecords.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
                  {t("tokenUsage.promptCount", "{{count}} prompts", {
                    count: displayRecords.length,
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0" viewportClassName="p-4">
        <div>
          {loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              {t("tokenUsage.loading", "Loading…")}
            </div>
          ) : displayRecords.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("tokenUsage.noData", "No token breakdown data available")}
            </div>
          ) : (
            <>
              <SessionSummary records={displayRecords} />
              <div>
                {displayRecords
                  .map((record, index) => ({ record, index }))
                  .reverse()
                  .map(({ record, index }) => (
                    <PromptUsageItem
                      key={`${record.timestamp}-${index}`}
                      record={record}
                      promptNumber={index + 1}
                      defaultExpanded={index === displayRecords.length - 1}
                    />
                  ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function PromptUsageItem({
  record,
  promptNumber,
  defaultExpanded,
}: {
  record: SessionTokenUsage;
  promptNumber: number;
  defaultExpanded: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const breakdown = getBreakdown(record.usage);
  const stepCount = breakdown?.steps.length ?? breakdown?.stepCount ?? 0;
  const toolCount = breakdown?.steps.reduce((total, step) => total + step.toolCalls.length, 0) ?? 0;

  return (
    <section className="border-b border-border/50 transition-colors first:border-t">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="w-full flex items-center p-2 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex size-5 shrink-0 items-center justify-center text-primary -ml-2.5">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </div>
        <MessageSquare className="size-3 shrink-0 text-muted-foreground ml-0.5" />
        <div className="min-w-0 flex flex-1 ml-2 truncate">
          <div className="flex items-center gap-2 mr-1">
            <span className="text-[11px] font-semibold">
              {t("tokenUsage.promptLabel", "Prompt #{{count}}", { count: promptNumber })}
            </span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums mo">
              {formatTimestamp(record.timestamp)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground ml-2">
            <div className="flex items-baseline shrink-0 gap-1">
              <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground/85">
                {stepCount}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {t("tokenUsage.steps", "steps")}
              </span>
            </div>
            <div className="flex items-baseline shrink-0 gap-1">
              <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground/85">
                {toolCount}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {t("tokenUsage.toolCalls", "tool calls")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-baseline shrink-0 ml-2 gap-1">
          <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground/85">
            {record.usage.totalTokens.toLocaleString()}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {t("tokenUsage.tokens", "tokens")}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 py-2.5 space-y-3">
          <PromptSummary usage={record.usage} />
          {breakdown ? (
            <>
              <UserMessageSection text={breakdown.inputComposition.userMessageText} />
              <InputCompositionSection composition={breakdown.inputComposition} />
              <ToolsBreakdownSection tools={breakdown.inputComposition.toolsDefinition} />
              <StepsSection steps={breakdown.steps} />
              <PerformanceSection performance={breakdown.performance} steps={breakdown.steps} />
            </>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
              {t("tokenUsage.noBreakdown", "No detailed breakdown available for this prompt")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PromptSummary({ usage }: { usage: SessionTokenUsage["usage"] }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <MetricCard
        label={t("tokenUsage.input", "Input")}
        value={usage.inputTokens.toLocaleString()}
      />
      <MetricCard
        label={t("tokenUsage.output", "Output")}
        value={usage.outputTokens.toLocaleString()}
      />
      <MetricCard
        label={t("tokenUsage.totalTokens", "Total")}
        value={usage.totalTokens.toLocaleString()}
      />
      {usage.thoughtTokens != null && usage.thoughtTokens > 0 && (
        <MetricCard
          label={t("tokenUsage.thought", "Thought")}
          value={usage.thoughtTokens.toLocaleString()}
        />
      )}
      {usage.cachedReadTokens != null && usage.cachedReadTokens > 0 && (
        <MetricCard
          label={t("tokenUsage.cacheRead", "Cache Read")}
          value={usage.cachedReadTokens.toLocaleString()}
        />
      )}
      {usage.cachedWriteTokens != null && usage.cachedWriteTokens > 0 && (
        <MetricCard
          label={t("tokenUsage.cacheWrite", "Cache Write")}
          value={usage.cachedWriteTokens.toLocaleString()}
        />
      )}
    </div>
  );
}

// ─── Session Summary ─────────────────────────────────────────────────────────

function SessionSummary({ records }: { records: SessionTokenUsage[] }) {
  const { t } = useTranslation();
  const totalInput = records.reduce((sum, record) => sum + record.usage.inputTokens, 0);
  const totalOutput = records.reduce((sum, record) => sum + record.usage.outputTokens, 0);
  const totalThought = records.reduce((sum, record) => sum + (record.usage.thoughtTokens ?? 0), 0);
  const totalCached = records.reduce(
    (sum, record) => sum + (record.usage.cachedReadTokens ?? 0),
    0,
  );

  return (
    <section className="pb-3">
      <SectionHeader
        icon={MessagesSquare}
        title={t("tokenUsage.sessionTotal", "Session Total")}
        badge={t("tokenUsage.promptCount", "{{count}} prompts", {
          count: records.length,
        })}
      />
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <MetricCard label={t("tokenUsage.input", "Input")} value={totalInput.toLocaleString()} />
        <MetricCard label={t("tokenUsage.output", "Output")} value={totalOutput.toLocaleString()} />
        <MetricCard
          label={t("tokenUsage.totalTokens", "Total")}
          value={(totalInput + totalOutput).toLocaleString()}
        />
        {totalThought > 0 && (
          <MetricCard
            label={t("tokenUsage.thought", "Thought")}
            value={totalThought.toLocaleString()}
          />
        )}
        {totalCached > 0 && (
          <MetricCard
            label={t("tokenUsage.cached", "Cached")}
            value={totalCached.toLocaleString()}
          />
        )}
      </div>
    </section>
  );
}

// ─── Input Composition ───────────────────────────────────────────────────────

function InputCompositionSection({ composition }: { composition: SessionTokenInputComposition }) {
  const { t } = useTranslation();
  const parts = [
    {
      label: t("tokenUsage.systemPrompt", "System Prompt"),
      value: composition.systemPrompt,
      color: "bg-blue-500/80",
    },
    {
      label: t("tokenUsage.tools", "Tools"),
      value: composition.toolsDefinition.total,
      color: "bg-amber-500/80",
    },
    {
      label: t("tokenUsage.history", "History"),
      value: composition.history,
      color: "bg-emerald-500/80",
    },
    {
      label: t("tokenUsage.userMessage", "User Message"),
      value: composition.userMessage,
      color: "bg-purple-500/80",
    },
  ];
  const total = composition.estimatedTotal || parts.reduce((sum, part) => sum + part.value, 0);

  return (
    <section className="border-t border-border/50 pt-3">
      <SectionHeader icon={Layers} title={t("tokenUsage.inputComposition", "Input Composition")} />
      <div className="h-2.5 w-full rounded-full bg-muted/80 overflow-hidden flex mt-2.5 ring-1 ring-border/30">
        {parts.map(
          (part) =>
            part.value > 0 && (
              <div
                key={part.label}
                className={cn("h-full", part.color)}
                style={{ width: `${total > 0 ? (part.value / total) * 100 : 0}%` }}
              />
            ),
        )}
      </div>
      <div className="my-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={cn("size-2 rounded-sm shrink-0", part.color)} />
              <span className="text-muted-foreground truncate">{part.label}</span>
            </div>
            <span className="font-mono tabular-nums text-muted-foreground shrink-0">
              {part.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {composition.delta !== 0 && (
        <div className="mt-1.5 text-[10px] text-muted-foreground/60">
          {t("tokenUsage.delta", "Estimation delta")}: {composition.delta > 0 ? "+" : ""}
          {composition.delta.toLocaleString()} {t("tokenUsage.tokens", "tokens")}
        </div>
      )}
    </section>
  );
}

// ─── User Message ────────────────────────────────────────────────────────────

function UserMessageSection({ text }: { text: string }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <section className="border-t border-border/50 pt-3">
      <SectionHeader icon={MessageSquare} title={t("tokenUsage.userMessage", "User Message")} />
      <ScrollArea viewportClassName="mt-2 max-h-40 rounded-md border border-border/60 bg-muted/30">
        <pre className="whitespace-pre-wrap wrap-break-word px-2 py-1.5 text-[10px] leading-relaxed text-foreground/70 font-mono">
          {text}
        </pre>
      </ScrollArea>
    </section>
  );
}

// ─── Tools Definition ────────────────────────────────────────────────────────

function ToolsBreakdownSection({ tools }: { tools: SessionTokenToolsDefinition }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (tools.perTool.length === 0) return null;

  const sorted = [...tools.perTool].sort((a, b) => b.tokens - a.tokens);
  const topCount = expanded ? sorted.length : 8;
  const topTools = sorted.slice(0, topCount);
  const rest = sorted.slice(topCount);
  const restTotal = rest.reduce((sum, tool) => sum + tool.tokens, 0);

  return (
    <section className="border-t border-border/50 pt-3">
      <SectionHeader
        icon={Wrench}
        title={t("tokenUsage.toolsDefinition", "Tools Definition")}
        badge={t("tokenUsage.toolsCount", "{{count}} tools · {{tokens}} tokens", {
          count: tools.perTool.length,
          tokens: tools.total.toLocaleString(),
        })}
      />
      <div className="mt-2 space-y-1 text-[10px]">
        {topTools.map((tool) => (
          <div
            key={tool.name}
            className="flex items-center gap-2 rounded px-1 -mx-1 py-0.5 hover:bg-muted/40 transition-colors"
          >
            <span className="flex-1 min-w-0 truncate font-mono text-muted-foreground">
              {tool.name}
            </span>
            <span className="font-mono tabular-nums font-medium text-foreground/75 shrink-0">
              {tool.tokens.toLocaleString()}
            </span>
            <div className="w-16 h-1 rounded-full bg-muted overflow-hidden shrink-0">
              <div
                className="h-full bg-amber-500/60 rounded-full"
                style={{ width: `${(tool.tokens / (sorted[0]?.tokens || 1)) * 100}%` }}
              />
            </div>
          </div>
        ))}
        {rest.length > 0 && (
          <div
            className="flex items-center gap-2 text-muted-foreground/60 hover:underline cursor-default"
            onClick={() => setExpanded(true)}
          >
            <span className="flex-1">
              {t("tokenUsage.more", "+{{count}} more", { count: rest.length })}
            </span>
            <span className="font-mono tabular-nums shrink-0">{restTotal.toLocaleString()}</span>
            <div className="w-16 shrink-0" />
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Steps and Tool Calls ────────────────────────────────────────────────────

function StepsSection({ steps }: { steps: SessionTokenStep[] }) {
  const { t } = useTranslation();
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(() => new Set());

  if (steps.length === 0) return null;

  const toggleStep = (stepNumber: number) => {
    setExpandedSteps((current) => {
      const next = new Set(current);
      if (next.has(stepNumber)) next.delete(stepNumber);
      else next.add(stepNumber);
      return next;
    });
  };

  return (
    <section className="border-t border-border/50 pt-3">
      <SectionHeader
        icon={Layers}
        title={t("tokenUsage.steps", "Steps")}
        badge={t("tokenUsage.stepsCount", "{{count}} steps", { count: steps.length })}
      />
      <div className="mt-2">
        {steps.map((step) => {
          const expanded = expandedSteps.has(step.stepNumber);
          return (
            <div
              key={step.stepNumber}
              className="transition-colors border-b border-border/70 last:border-transparent"
            >
              <button
                type="button"
                onClick={() => toggleStep(step.stepNumber)}
                className="w-full flex items-center py-1.5 text-left hover:bg-muted/30 transition-colors px-1"
              >
                <div className="flex size-5 shrink-0 items-center justify-center text-primary -ml-2">
                  {expanded ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                </div>
                <div className="flex gap-2 items-center ml-0.5">
                  <span className="flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0">
                    #{step.stepNumber}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase truncate",
                      finishReasonBadge(step.finishReason),
                    )}
                  >
                    {step.finishReason}
                  </span>
                </div>
                <div className="flex gap-4 ml-auto font-mono text-[10px] tabular-nums text-muted-foreground shrink-0">
                  {step.toolCalls.length > 0 && (
                    <div className="flex items-baseline shrink-0 gap-1">
                      <span>{step.toolCalls.length}</span>
                      <span className="text-muted-foreground/70">
                        {t("tokenUsage.toolCalls", "tool calls")}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <span>{step.inputTokens.toLocaleString()}</span>
                    <span className="text-muted-foreground/70">
                      {t("tokenUsage.inputShort", "in")}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <span>{step.outputTokens.toLocaleString()}</span>
                    <span className="text-muted-foreground/70">
                      {t("tokenUsage.outputShort", "out")}
                    </span>
                  </div>
                </div>
              </button>
              {expanded && <StepDetails step={step} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepDetails({ step }: { step: SessionTokenStep }) {
  const { t } = useTranslation();
  const { inputDetails, outputDetails, performance } = step;

  return (
    <div className="border-t border-border/40">
      <div className="grid grid-cols-2 gap-1 py-1">
        <DetailMetric
          label={t("tokenUsage.input", "Input")}
          value={step.inputTokens.toLocaleString()}
        />
        <DetailMetric
          label={t("tokenUsage.output", "Output")}
          value={step.outputTokens.toLocaleString()}
        />
      </div>
      <div className="text-[10px] space-y-1">
        {inputDetails.cacheReadTokens != null && inputDetails.cacheReadTokens > 0 && (
          <MetricRow
            label={t("tokenUsage.cacheRead", "Cache Read")}
            value={inputDetails.cacheReadTokens.toLocaleString()}
          />
        )}
        {inputDetails.cacheWriteTokens != null && inputDetails.cacheWriteTokens > 0 && (
          <MetricRow
            label={t("tokenUsage.cacheWrite", "Cache Write")}
            value={inputDetails.cacheWriteTokens.toLocaleString()}
          />
        )}
        {inputDetails.noCacheTokens != null && inputDetails.noCacheTokens > 0 && (
          <MetricRow
            label={t("tokenUsage.noCache", "No Cache")}
            value={inputDetails.noCacheTokens.toLocaleString()}
          />
        )}
        {outputDetails.textTokens != null && outputDetails.textTokens > 0 && (
          <MetricRow
            label={t("tokenUsage.text", "Text")}
            value={outputDetails.textTokens.toLocaleString()}
          />
        )}
        {outputDetails.reasoningTokens != null && outputDetails.reasoningTokens > 0 && (
          <MetricRow
            label={t("tokenUsage.thought", "Thought")}
            value={outputDetails.reasoningTokens.toLocaleString()}
          />
        )}
        <MetricRow
          label={t("tokenUsage.stepTime", "Step Time")}
          value={formatMs(performance.stepTimeMs)}
        />
        <MetricRow
          label={t("tokenUsage.responseTime", "Response Time")}
          value={formatMs(performance.responseTimeMs)}
        />
      </div>
      {step.toolCalls.length > 0 && (
        <div className="pt-1 mt-3 border-t border-border/40">
          <div className="space-y-1">
            {step.toolCalls.map((toolCall, index) => (
              <ToolCallRow key={`${toolCall.toolName}-${index}`} toolCall={toolCall} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ toolCall }: { toolCall: SessionTokenToolCall }) {
  const { t } = useTranslation();
  return (
    <div className="py-4 border-t border-border/40 first:border-transparent -mt-px">
      <div className="flex items-center gap-1.5 min-w-0">
        <Wrench className="size-3 shrink-0 text-foreground/80" />
        <span className="font-mono text-[10px] font-medium text-foreground/80 truncate">
          {shortToolName(toolCall.toolName)}
        </span>
        <span className="ml-auto max-w-[45%] truncate text-[10px] text-muted-foreground/50 font-mono">
          {toolCall.toolName}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 -mb-2">
        <DetailMetric
          label={t("tokenUsage.arguments", "Arguments")}
          value={`${toolCall.argumentsOutputTokens.toLocaleString()} ${t("tokenUsage.token", "token")}`}
        />
        <DetailMetric
          label={t("tokenUsage.result", "Result")}
          value={`${toolCall.resultInputTokens.toLocaleString()} ${t("tokenUsage.token", "token")}`}
        />
        <DetailMetric
          label={t("tokenUsage.execution", "Execution")}
          value={toolCall.executionMs != null ? formatMs(toolCall.executionMs) : "—"}
        />
      </div>
      {toolCall.args && (
        <div className="mt-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 mb-1">
            {t("tokenUsage.arguments", "Arguments")}
          </div>
          <ScrollArea viewportClassName="max-h-32 rounded-md border border-border/60 bg-muted/30">
            <pre className="whitespace-pre-wrap wrap-break-word px-2 py-1.5 text-[10px] leading-relaxed text-foreground/70 font-mono">
              {formatToolArgs(toolCall.args)}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ─── Performance ─────────────────────────────────────────────────────────────

function PerformanceSection({
  performance,
  steps,
}: {
  performance: SessionTokenPerformance;
  steps: SessionTokenStep[];
}) {
  const { t } = useTranslation();
  const ttft = steps[0]?.performance.timeToFirstOutputMs;

  return (
    <section className="border-t border-border/50 pt-3">
      <SectionHeader icon={Gauge} title={t("tokenUsage.performance", "Performance")} />
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <DetailMetric
          label={t("tokenUsage.totalTime", "Total Time")}
          value={formatMs(performance.totalTimeMs)}
        />
        <DetailMetric
          label={t("tokenUsage.outputSpeed", "Output Speed")}
          value={`${Math.round(performance.effectiveOutputTokensPerSecond)} ${t("tokenUsage.tokensPerSecond", "token/s")}`}
        />
        {ttft != null && (
          <DetailMetric label={t("tokenUsage.firstToken", "First Token")} value={formatMs(ttft)} />
        )}
      </div>
    </section>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground/70 truncate">
        {value}
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide truncate text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-1.5 font-mono text-xs font-medium tabular-nums text-foreground/70 truncate">
        {value}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3 text-muted-foreground" />
      <span className="text-xs font-semibold text-foreground/80">{title}</span>
      {badge && <span className="text-[10px] text-muted-foreground/60 ml-auto">{badge}</span>}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between min-w-0 gap-2 hover:bg-accent/60 px-1 py-0.5 -mx-1 rounded-sm">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="font-mono tabular-nums text-foreground/80 shrink-0">{value}</span>
    </div>
  );
}

// ─── Data helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTokenUsageRecords(records: ReadonlyArray<unknown>): SessionTokenUsage[] {
  const parsed: SessionTokenUsage[] = [];
  for (const record of records) {
    if (isTokenUsageRecord(record)) parsed.push(record);
  }
  return parsed;
}

function isTokenUsageRecord(value: unknown): value is SessionTokenUsage {
  if (!isRecord(value) || typeof value.timestamp !== "number" || !isRecord(value.usage)) {
    return false;
  }
  return (
    typeof value.usage.totalTokens === "number" &&
    typeof value.usage.inputTokens === "number" &&
    typeof value.usage.outputTokens === "number"
  );
}

function isTokenBreakdown(value: unknown): value is SessionTokenBreakdown {
  if (!isRecord(value)) return false;
  const composition = value.inputComposition;
  return (
    typeof value.stepCount === "number" &&
    Array.isArray(value.steps) &&
    isRecord(composition) &&
    isRecord(composition.toolsDefinition) &&
    Array.isArray(composition.toolsDefinition.perTool) &&
    isRecord(value.performance)
  );
}

function getBreakdown(usage: SessionTokenUsage["usage"]): SessionTokenBreakdown | undefined {
  const breakdown = usage._meta?.fello?.tokenBreakdown;
  return isTokenBreakdown(breakdown) ? breakdown : undefined;
}

function createLiveRecord(
  usage: SessionInfo["lastTurnUsage"],
  timestamp: number,
): SessionTokenUsage | null {
  if (!usage) return null;
  const breakdown = getBreakdownFromUnknownUsage(usage);
  if (!breakdown) return null;
  return {
    timestamp,
    usage: {
      totalTokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thoughtTokens: usage.thoughtTokens,
      cachedReadTokens: usage.cachedReadTokens,
      cachedWriteTokens: usage.cachedWriteTokens,
      _meta: { fello: { tokenBreakdown: breakdown } },
    },
  };
}

function finishReasonBadge(reason: string): string {
  if (reason === "stop" || reason === "end_turn") {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (reason === "tool_calls" || reason === "tool_call") {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  if (reason === "length" || reason === "max_tokens") {
    return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
  }
  return "bg-muted text-muted-foreground";
}

function getBreakdownFromUnknownUsage(usage: unknown): SessionTokenBreakdown | undefined {
  if (!isRecord(usage) || !isRecord(usage._meta) || !isRecord(usage._meta.fello)) {
    return undefined;
  }
  return isTokenBreakdown(usage._meta.fello.tokenBreakdown)
    ? usage._meta.fello.tokenBreakdown
    : undefined;
}

function mergeLiveRecord(records: SessionTokenUsage[], liveRecord: SessionTokenUsage | null) {
  if (!liveRecord) return records;
  const lastRecord = records[records.length - 1];
  if (
    lastRecord &&
    getUsageFingerprint(lastRecord.usage) === getUsageFingerprint(liveRecord.usage)
  ) {
    return records;
  }
  return [...records, liveRecord];
}

function getUsageFingerprint(usage: SessionTokenUsage["usage"]): string {
  return JSON.stringify(usage) ?? "";
}

function shortToolName(name: string): string {
  const parts = name.split("__");
  return parts[parts.length - 1] || name;
}

/** Pretty-print tool call args JSON when possible; fall back to the raw string. */
function formatToolArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
