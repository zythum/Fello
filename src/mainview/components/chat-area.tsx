import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActiveSessionState } from "../store";
import { isValidMessageToDisplay } from "../chat-message";
import { MessageBubble } from "./message-bubble";
import type { ChatTimelineItem } from "./chat-timeline";
import { ChatTimeline } from "./chat-timeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

export function ChatArea() {
  const { t } = useTranslation();
  const { messages, isStreaming, activeToolCalls } = useActiveSessionState();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoScrolledOnMountRef = useRef(false);
  const userHasScrolledUpRef = useRef(false);
  const userMessageElementRefs = useRef(new Map<string, HTMLElement>());
  const userMessageIdsRef = useRef<string[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showThinking, setShowThinking] = useState(false);
  const [activeUserMessageId, setActiveUserMessageId] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: any = null;
    setShowThinking(false);
    if (isStreaming) {
      timeoutId = setTimeout(() => {
        setShowThinking(true);
        timeoutId = null;
      }, 1000);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  }, [messages, activeToolCalls, isStreaming]);

  const getViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (behavior === "smooth") {
      scrollTimeoutRef.current = setTimeout(() => {
        userHasScrolledUpRef.current = false;
        bottomRef.current?.scrollIntoView({ behavior });
      }, 100);
      return;
    }

    userHasScrolledUpRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollToBottomAuto = useCallback(() => {
    scrollToBottom("auto");
  }, [scrollToBottom]);

  const scrollToBottomManual = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    let rafId: number | null = null;
    const computeActiveUserMessage = () => {
      const ids = userMessageIdsRef.current;
      if (ids.length === 0) {
        setActiveUserMessageId((prev) => (prev === null ? prev : null));
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const threshold = 16;
      const scrollTop = viewport.scrollTop;

      let activeId: string | null = null;
      let bestTop = -Infinity;

      for (const id of ids) {
        const el = userMessageElementRefs.current.get(id);
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top - viewportRect.top + scrollTop;
        if (elTop <= scrollTop + threshold && elTop > bestTop) {
          bestTop = elTop;
          activeId = id;
        }
      }

      const nextActive = activeId ?? ids[0] ?? null;
      setActiveUserMessageId((prev) => (prev === nextActive ? prev : nextActive));
    };

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const nextIsAtBottom = scrollHeight - scrollTop - clientHeight < 40;
      userHasScrolledUpRef.current = !nextIsAtBottom;
      setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));

      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeActiveUserMessage();
      });
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [getViewport]);

  const renderedMessages = useMemo(() => messages.filter(isValidMessageToDisplay), [messages]);
  const timelineItems = useMemo<ChatTimelineItem[]>(
    () =>
      renderedMessages
        .filter((msg) => msg.role === "user_message")
        .map((msg, index) => ({
          displayId: msg.displayId,
          index: index + 1,
          content: msg.contents.find((content) => content.type === "text")?.text ?? "",
        })),
    [renderedMessages],
  );
  const timelineDisplayIds = useMemo(() => timelineItems.map((x) => x.displayId), [timelineItems]);
  const firstTimelineDisplayId = timelineDisplayIds[0] ?? null;
  const timelineDisplayIdsKey = useMemo(() => {
    const last = timelineDisplayIds[timelineDisplayIds.length - 1] ?? "";
    return `${timelineDisplayIds.length}:${last}`;
  }, [timelineDisplayIds]);
  userMessageIdsRef.current = timelineDisplayIds;

  useEffect(() => {
    setActiveUserMessageId((prev) => prev ?? firstTimelineDisplayId);
    const viewport = getViewport();
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
  }, [firstTimelineDisplayId, timelineDisplayIdsKey, getViewport]);

  useEffect(() => {
    if (!hasAutoScrolledOnMountRef.current) {
      hasAutoScrolledOnMountRef.current = true;
      scrollToBottomAuto();
      return;
    }

    if (!userHasScrolledUpRef.current && (isAtBottom || isStreaming)) {
      scrollToBottomAuto();
    }
  }, [messages, activeToolCalls.size, isAtBottom, isStreaming, scrollToBottomAuto]);

  const setUserMessageElement = useCallback((displayId: string, el: HTMLElement | null) => {
    if (!el) {
      userMessageElementRefs.current.delete(displayId);
      return;
    }
    userMessageElementRefs.current.set(displayId, el);
  }, []);

  const scrollToUserMessage = useCallback(
    (displayId: string) => {
      const viewport = getViewport();
      const el = userMessageElementRefs.current.get(displayId);
      if (!viewport || !el) return;
      const viewportRect = viewport.getBoundingClientRect();
      const scrollTop = viewport.scrollTop;
      const elTop = el.getBoundingClientRect().top - viewportRect.top + scrollTop;
      viewport.scrollTo({ top: Math.max(0, elTop - 12), behavior: "smooth" });
    },
    [getViewport],
  );

  return (
    <div className="w-full relative min-h-0 flex flex-1 overflow-hidden">
      <div className="shrink-0 w-6">
        <ChatTimeline
          items={timelineItems}
          activeDisplayId={activeUserMessageId}
          onSelect={scrollToUserMessage}
        />
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 pl-2 pr-8">
        <div className="py-4 max-w-3xl mx-auto">
          {renderedMessages.map((msg, i, arr) => {
            const isLastRendered = i === arr.length - 1;
            const isStreamableRole = msg.role === "agent_message" || msg.role === "agent_thought";
            const isLastMessageStreaming = isStreaming && isLastRendered && isStreamableRole;

            return (
              <div
                key={msg.displayId}
                ref={(el) => {
                  if (msg.role !== "user_message") return;
                  setUserMessageElement(msg.displayId, el);
                }}
                className="chat-message"
                data-role={msg.role}
                data-display-id={msg.displayId}
              >
                <MessageBubble
                  message={msg}
                  prevBubbleRole={arr[i - 1]?.role}
                  nextBubbleRole={arr[i + 1]?.role}
                  isStreaming={isLastMessageStreaming}
                />
              </div>
            );
          })}

          {showThinking && (
            <div className="flex items-center gap-1.5 px-4 py-2 mt-2 text-[11px] text-muted-foreground/50 uppercase tracking-widest">
              <span className="animate-shimmer-text">{t("chatArea.thinking", "Thinking...")}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {!isAtBottom && (
        <Button
          variant="secondary"
          size="icon-sm"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg border border-border"
          onClick={scrollToBottomManual}
          aria-label={t("chatArea.scrollToBottom", "Scroll to bottom")}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
