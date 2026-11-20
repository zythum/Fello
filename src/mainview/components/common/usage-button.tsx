import { useTranslation } from "react-i18next";
import { ReceiptTurkishLira } from "lucide-react";
import { useAppStore } from "../../store";
import { buttonVariants } from "@/components/ui/button";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { SessionInfo } from "../../../shared/schema";

export function UsageButton({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const configuredAgents = useAppStore((s) => s.configuredAgents);
  const { lastTurnUsage, usage } = session;
  const isApiAgent = configuredAgents.some(
    (agent) => agent.id === session.agentId && agent.type === "api",
  );

  const hasData = usage || lastTurnUsage;

  if (!hasData) return null;

  const pct = usage?.size ? (usage.used / usage.size) * 100 : 0;
  const pctColor = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-primary";

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors data-pressed:bg-sidebar-accent/40">
        <ReceiptTurkishLira className="size-4" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
          <PopoverPrimitive.Popup className="z-10 w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none p-4 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
            <div className="space-y-4 text-xs">
              {/* Context window */}
              {usage && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-foreground/80">
                      {t("chatHeader.contextWindow")}
                    </span>
                    {usage.size > 1 ? (
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {usage.used.toLocaleString()} / {usage.size.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pctColor}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/60">
                    <span>{t("chatHeader.percentUsed", { pct: pct.toFixed(2) })}</span>
                    {usage.size > 1 ? (
                      <span>
                        {t("chatHeader.remaining", {
                          count: (usage.size - usage.used).toLocaleString(),
                        })}
                      </span>
                    ) : null}
                  </div>
                  {usage.cost && (
                    <div className="mt-2 flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{t("chatHeader.cost")}</span>
                      <span className="font-mono tabular-nums text-foreground/80">
                        {usage.cost.amount} {usage.cost.currency}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Last turn usage */}
              {lastTurnUsage && (
                <div>
                  <div className="border-t border-border/50 pt-3">
                    <div className="font-semibold text-foreground/80 mb-2">
                      {t("chatHeader.lastTurn")}
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <Row label={t("chatHeader.input")} value={lastTurnUsage.inputTokens} />
                      <Row label={t("chatHeader.output")} value={lastTurnUsage.outputTokens} />
                      <Row label={t("chatHeader.total")} value={lastTurnUsage.totalTokens} bold />
                      {lastTurnUsage.thoughtTokens != null && (
                        <Row label={t("chatHeader.thought")} value={lastTurnUsage.thoughtTokens} />
                      )}
                      {lastTurnUsage.cachedReadTokens != null && (
                        <Row
                          label={t("chatHeader.cacheRead")}
                          value={lastTurnUsage.cachedReadTokens}
                        />
                      )}
                      {lastTurnUsage.cachedWriteTokens != null && (
                        <Row
                          label={t("chatHeader.cacheWrite")}
                          value={lastTurnUsage.cachedWriteTokens}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {isApiAgent && (
                <PopoverPrimitive.Close
                  className={buttonVariants({
                    variant: "outline",
                    size: "xs",
                    className: "w-full py-3 font-normal border-border!",
                  })}
                  onClick={() => {
                    document.dispatchEvent(new CustomEvent("fello-open-token-usage"));
                  }}
                >
                  {t("chatHeader.viewBreakdown", "View Breakdown")}
                </PopoverPrimitive.Close>
              )}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
