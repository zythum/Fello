import { useCallback, useEffect, useMemo, useState } from "react";
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

/** 每个 item 占用的近似高度（px），含 p-1(8px) + size-2(8px) + gap-0.5(2px) */
const ITEM_STEP = 18;
const MIN_WINDOW = 5;

export function ChatTimeline({ items, activeDisplayId, onSelect }: Props) {
  const { t } = useTranslation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [windowSize, setWindowSize] = useState(30);

  // ── 根据容器高度动态计算窗口大小 ──
  useEffect(() => {
    if (!container) return;

    const calc = () => {
      const h = container.clientHeight;
      if (h > 0) {
        setWindowSize(Math.max(MIN_WINDOW, Math.floor(h / ITEM_STEP)));
      }
    };

    calc();
    const observer = new ResizeObserver(calc);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const handleSelect = useCallback(
    (displayId: string) => {
      onSelect(displayId);
    },
    [onSelect],
  );

  const visibleItems = useMemo(() => {
    if (items.length < 2) return [];

    // 需要截断时使用基数，让活跃消息完美居中
    const size = items.length > windowSize && windowSize % 2 === 0
      ? windowSize - 1
      : windowSize;

    const activeIndex = activeDisplayId
      ? items.findIndex((item) => item.displayId === activeDisplayId)
      : -1;

    const half = Math.floor(size / 2);
    let start: number;
    let end: number;

    if (activeIndex === -1) {
      // 没有活跃消息，显示开头
      start = 0;
      end = Math.min(size, items.length);
    } else {
      start = activeIndex - half;
      end = start + size;
      // 越界修正
      if (start < 0) {
        start = 0;
        end = size;
      }
      if (end > items.length) {
        end = items.length;
        start = Math.max(0, end - size);
      }
    }

    return items.slice(start, end);
  }, [items, activeDisplayId, windowSize]);

  if (visibleItems.length < 2) return null;

  return (
    <div ref={setContainer} className="h-full flex flex-col items-center overflow-hidden">
      <div className="min-h-full flex flex-col items-center justify-center gap-0.5">
        {visibleItems.map((item) => {
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
                <div className="line-clamp-2 max-w-70 text-xs leading-relaxed">
                  {item.content || label}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
