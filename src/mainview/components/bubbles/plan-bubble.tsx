import { memo } from "react";
import type { PlanMessage } from "../../chat-message";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Check, Loader2, ChevronUp, ChevronDown, Minus } from "lucide-react";

export const PlanBubble = memo(function PlanBubble({
  message,
  prevBubbleRole,
}: {
  message: PlanMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}) {
  const { t } = useTranslation();
  const total = message.entries?.length || 0;
  const completed = message.entries?.filter((e) => e.status === "completed").length || 0;

  return (
    <details
      className={cn(
        "mx-4 border border-border bg-card rounded-md pointer-events-auto",
        prevBubbleRole != null && "mt-4",
      )}
      open
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <span className="flex-1 text-foreground">{t("planBubble.title")}</span>
        {total > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t("planBubble.summary", { completed, total })}
          </span>
        )}
      </summary>
      {total > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="flex flex-col gap-3">
            {message.entries.map((entry, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {entry.status === "completed" ? (
                    <Check className="size-3.5 text-green-500" />
                  ) : (
                    <Loader2
                      className={cn(
                        "size-3.5",
                        entry.status === "in_progress"
                          ? "animate-spin text-primary"
                          : "text-muted-foreground/50",
                      )}
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div
                    className={cn(
                      "text-foreground break-words leading-relaxed",
                      entry.status === "completed" &&
                        "text-muted-foreground line-through opacity-70",
                    )}
                  >
                    {entry.content}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                    <span className="flex items-center">
                      {entry.priority === "high" && (
                        <ChevronUp className="size-3 mr-0.5 text-destructive/70" />
                      )}
                      {entry.priority === "low" && <ChevronDown className="size-3 mr-0.5" />}
                      {entry.priority === "medium" && <Minus className="size-3 mr-0.5" />}
                      {t(`planBubble.priority.${entry.priority}`)}
                    </span>
                    <span>·</span>
                    <span
                      className={cn(entry.status === "in_progress" && "text-primary font-medium")}
                    >
                      {t(
                        entry.status === "in_progress"
                          ? "planBubble.status.inProgress"
                          : `planBubble.status.${entry.status}`,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </details>
  );
});
