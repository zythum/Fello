import { memo, useRef, useState, useEffect } from "react";
import type { UserMessage } from "../../chat-message";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { useAppStore } from "../../store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  message: UserMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}

export const UserBubble = memo(function UserBubble({ message }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === activeSessionId));

  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkOverflow = () => {
      // 13px text with snug leading (1.375) is ~18px per line.
      // 2 lines = 36px. We use 44px as the threshold to safely detect > 2 lines.
      setIsOverflowing(el.scrollHeight > 50);
    };

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    checkOverflow();
    return () => observer.disconnect();
  }, [message.contents, isExpanded]);

  return (
    <div className="flex flex-col">
      <div className="flex justify-end">
        <div className="relative min-w-12 max-w-[80%] rounded-3xl rounded-tr-sm border border-border bg-secondary px-3 py-2 text-[13px] leading-snug font-normal text-card-foreground/75 pointer-events-auto group">
          <div className="relative flex">
            <div
              className={cn(
                "flex-1 min-w-0",
                !isExpanded ? "line-clamp-2" : "max-h-45",
                (isOverflowing || isExpanded) && "pr-4",
              )}
            >
              {isExpanded ? (
                <ScrollArea className="h-full max-h-45 pr-1">
                  <div ref={contentRef}>
                    <ContentBlocks
                      blocks={message.contents}
                      role={message.role}
                      session={session}
                    />
                  </div>
                </ScrollArea>
              ) : (
                <div ref={contentRef} className="pr-1 [&>div]:block! [&>div>*:not(:first-child)]:mt-2!">
                  <ContentBlocks blocks={message.contents} role={message.role} session={session} />
                </div>
              )}
            </div>

            {(isOverflowing || isExpanded) && (
              <div className="absolute top-0 -right-1 h-full flex items-start">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 bg-transparent hover:bg-transparent hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                >
                  {isExpanded ? (
                    <ChevronsDownUp className="size-3.5" />
                  ) : (
                    <ChevronsUpDown className="size-3.5" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
