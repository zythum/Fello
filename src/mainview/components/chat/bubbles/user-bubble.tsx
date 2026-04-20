import { memo, useRef, useState, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, ChevronsDownUp, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "../../content-blocks/content-blocks";
import type { UserMessage } from "../../../lib/chat-message";
import type { BaseBubbleProps } from "./types";

export const UserBubble = memo(function UserBubble({
  session,
  message,
  prevBubbleRole: _prevBubbleRole,
  nextBubbleRole: _nextBubbleRole,
  isStreaming: _isStreaming,
}: BaseBubbleProps<UserMessage>) {
  const { t } = useTranslation();

  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const textBlocks = message.contents.filter((c) => c.type === "text");
      const text = textBlocks.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2000);
        } catch (e) {
          console.error("Failed to copy text", e);
        }
      }
    },
    [message.contents],
  );

  const hasText = message.contents.some((c) => c.type === "text");

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
      <div className="flex justify-end items-stretch group/user-bubble">
        {hasText && (
          <div className="py-2 pl-2 pr-5 -mr-4 opacity-0 transition-opacity group-hover/user-bubble:opacity-100 pointer-events-auto">
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "size-6 shrink-0 bg-transparent hover:bg-transparent text-muted-foreground/60 hover:text-muted-foreground/80",
              )}
              onClick={handleCopy}
              title={t("userBubble.copy", "Copy")}
            >
              {hasCopied ? (
                <Check className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        )}
        <div className="group relative min-w-12 max-w-[80%] rounded-3xl rounded-tr-sm border border-border bg-secondary px-3 py-2 text-[13px] leading-snug font-normal text-card-foreground/75 pointer-events-auto">
          <div className="relative flex">
            <div
              className={cn(
                "flex-1 min-w-0",
                !isExpanded ? "line-clamp-2" : "max-h-45",
                (isOverflowing || isExpanded) && "pr-4",
              )}
            >
              {isExpanded ? (
                <ScrollArea className="h-full max-h-45 pr-2.5">
                  <div ref={contentRef}>
                    <ContentBlocks
                      blocks={message.contents}
                      role={message.role}
                      session={session}
                    />
                  </div>
                </ScrollArea>
              ) : (
                <div
                  ref={contentRef}
                  className="pr-1 [&>div]:block! [&>div>*:not(:first-child)]:mt-2!"
                >
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
