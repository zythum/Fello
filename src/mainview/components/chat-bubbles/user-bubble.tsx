import { memo, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";
import { copyText } from "@/lib/clipboard";
import {
  Bell,
  ChevronsUpDown,
  ChevronsDownUp,
  Copy,
  Check,
  ArrowUpToLine,
  SquareChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "../content-blocks/content-blocks";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { parseLeadingTag } from "../../../shared/message-tag";
import type { UserMessage } from "../../lib/chat-message";
import type { BaseBubbleProps } from "./base-bubble";

/** Leading tag types that get a badge. Tags of other types stay as plain text. */
const TAG_BADGES: Record<string, { icon: LucideIcon; className: string; labelKey: string; fallback: string }> = {
  Reminder: { icon: Bell, className: "text-yellow-400", labelKey: "userBubble.reminder", fallback: "Reminder" },
  Worker: {
    icon: SquareChevronRight,
    className: "text-sky-400",
    labelKey: "userBubble.worker",
    fallback: "Worker",
  },
};

/** 转义 markdown 特殊字符，使文本原样显示，不触发 markdown / HTML 渲染 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // 必须先转义反斜杠
    .replace(/\*/g, "\\*")
    .replace(/#/g, "\\#")
    .replace(/\//g, "\\/")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/_/g, "\\_")
    .replace(/-/g, "\\-")
    .replace(/`/g, "\\`");
}

export const UserBubble = memo(function UserBubble({
  session,
  message,
  isStreaming: _isStreaming,
}: BaseBubbleProps<UserMessage>) {
  const { t } = useTranslation();

  const contentRef = useRef<HTMLDivElement>(null);

  // A leading tag of a known type (for example [Reminder id="..."]) becomes a badge and is removed from the text.
  const leadingTag = useMemo(() => {
    const first = message.contents.find((block) => block.type === "text");
    const tag = first?.type === "text" ? parseLeadingTag(first.text) : null;
    return tag && Object.hasOwn(TAG_BADGES, tag.type) ? tag : null;
  }, [message.contents]);

  // 将 text block 包裹在代码块中，避免 markdown / HTML 渲染，以源码形式显示
  const safeContents = useMemo<ContentBlock[]>(() => {
    // The leading tag belongs to the first text block only.
    const firstTextIndex = message.contents.findIndex((block) => block.type === "text");
    return message.contents.map((block, index) => {
      if (block.type === "text") {
        const text = leadingTag && index === firstTextIndex ? leadingTag.body : block.text;
        return { ...block, text: escapeMarkdown(text) };
      }
      return block;
    });
  }, [message.contents, leadingTag]);

  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const textBlocks = message.contents.filter((c) => c.type === "text");
      const text = textBlocks.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      if (text) {
        const ok = await copyText(text);
        if (ok) {
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2000);
        }
      }
    },
    [message.contents],
  );

  const handleLocate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(
        new CustomEvent("fello-scroll-to-message", { detail: message.displayId }),
      );
    },
    [message.displayId],
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
      <div className="flex justify-end items-end group/user-bubble">
        {hasText && (
          <div className="pl-2 pr-5 -mr-4 opacity-0 transition-opacity group-hover/user-bubble:opacity-100 pointer-events-auto flex items-baseline gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "size-6 shrink-0 bg-transparent hover:bg-transparent text-muted-foreground/60 hover:text-muted-foreground/80",
              )}
              onClick={handleLocate}
              title={t("userBubble.locate", "Locate")}
            >
              <ArrowUpToLine className="size-3.5" />
            </Button>
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
        <div className="group relative min-w-12 max-w-[80%] rounded-3xl rounded-tr-sm border border-border bg-secondary p-2 text-[13px] leading-snug font-normal text-card-foreground/75 pointer-events-auto">
          {leadingTag && (
            <Badge className="absolute left-0 h-6 top-0 -translate-full ml-3 mt-3 shadow size-6">
              {(() => {
                const badge = TAG_BADGES[leadingTag.type];
                const Icon = badge.icon;
                const className = badge.className;
                return (
                  <>
                    <Icon className={cn("-m-1", className)} aria-label={t(badge.labelKey, badge.fallback)} />
                  </>
                );
              })()}
            </Badge>
          )}
          <div className="relative flex">
            <div
              className={cn(
                "flex-1 min-w-0",
                !isExpanded ? "line-clamp-2 max-h-16" : "max-h-45",
                (isOverflowing || isExpanded) && "pr-4",
              )}
            >
              {isExpanded ? (
                <ScrollArea className="h-full max-h-45">
                  <div className="-my-2 px-0.5 pr-1" ref={contentRef}>
                    <ContentBlocks blocks={safeContents} role={message.role} session={session} />
                  </div>
                </ScrollArea>
              ) : (
                <div
                  ref={contentRef}
                  className="-my-2 px-0.5 pr-1 [&>div]:block! [&>div>*:not(:first-child)]:mt-2!"
                >
                  <ContentBlocks blocks={safeContents} role={message.role} session={session} />
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
