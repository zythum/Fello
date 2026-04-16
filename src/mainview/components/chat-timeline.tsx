import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ChatTimelineItem {
  displayId: string;
  index: number;
  content: string;
}

interface Props {
  items: ChatTimelineItem[];
  activeDisplayId: string | null;
  onSelect: (displayId: string) => void;
}

export function ChatTimeline({ items, activeDisplayId, onSelect }: Props) {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (displayId: string) => {
      onSelect(displayId);
    },
    [onSelect],
  );

  if (items.length < 2) return null;

  return (
    <div className="h-full flex flex-col items-center overflow-hidden">
      <div className="min-h-full flex flex-col items-center justify-center gap-0.5">
        {items.map((item) => {
          const isActive = activeDisplayId === item.displayId;
          const label = t("chatTimeline.userMessageIndex", "User message {{index}}", {
            index: item.index,
          });
          const ariaLabel = t("chatTimeline.jumpToUserMessage", "Jump to {{label}}", { label });

          return (
            <Tooltip key={item.displayId}>
              <TooltipTrigger
                type="button"
                onClick={() => handleSelect(item.displayId)}
                className="p-1 group"
                aria-label={ariaLabel}
              >
                <div
                  className={cn(
                    "size-2 rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive
                      ? "bg-foreground/40"
                      : "bg-muted-foreground/15 group-hover:bg-muted-foreground/40",
                  )}
                ></div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="line-clamp-2 max-w-70">{item.content || label}</div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
