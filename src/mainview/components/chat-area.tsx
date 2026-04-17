import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActiveSessionState } from "../store";
import { isValidMessageToDisplay } from "../chat-message";
import { MessageBubble } from "./bubbles/message-bubble";
import type { ChatTimelineItem } from "./chat-timeline";
import { ChatTimeline } from "./chat-timeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
      const nextIsAtBottom = scrollHeight - scrollTop - clientHeight < 100;
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

  const messageGroups = useMemo(() => {
    const groups: {
      key: string;
      userMessage?: (typeof renderedMessages)[0];
      contentMessages: typeof renderedMessages;
    }[] = [];
    let currentGroup: (typeof groups)[0] | null = null;

    for (const msg of renderedMessages) {
      if (msg.role === "user_message") {
        currentGroup = {
          key: msg.displayId,
          userMessage: msg,
          contentMessages: [],
        };
        groups.push(currentGroup);
      } else {
        if (!currentGroup) {
          currentGroup = {
            key: msg.displayId,
            contentMessages: [],
          };
          groups.push(currentGroup);
        }
        currentGroup.contentMessages.push(msg);
      }
    }
    return groups;
  }, [renderedMessages]);

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
      viewport.scrollTo({ top: Math.max(0, elTop), behavior: "smooth" });
    },
    [getViewport],
  );

  return (
    <div className="w-full relative min-h-0 flex flex-1 overflow-hidden">
      <div className="shrink-0 w-6 -mr-6 relative z-1">
        <ChatTimeline
          items={timelineItems}
          activeDisplayId={activeUserMessageId}
          onSelect={scrollToUserMessage}
        />
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 px-10">
        {messageGroups.map((group, groupIndex) => {
          const isFirstGroup = groupIndex === 0;
          const isLastGroup = groupIndex === messageGroups.length - 1;

          return (
            <div
              key={group.key}
              className={cn(
                "message-group max-w-3xl mx-auto flex flex-col relative pointer-events-none",
                {
                  "pt-4": !isFirstGroup,
                  "min-h-full": isLastGroup,
                  "border-b border-foreground/10 border-dashed": !isLastGroup,
                },
              )}
            >
              <div
                className="absolute top-0"
                ref={(el) => {
                  if (group.userMessage) {
                    setUserMessageElement(group.userMessage.displayId, el);
                  }
                }}
              />
              {group.userMessage && (
                <div className="message-header sticky z-5 top-0 pt-4 pb-14 -mb-5 bg-linear-to-b from-background via-background/95 via-65% to-background/0">
                  <div
                    className="chat-message"
                    data-role={group.userMessage.role}
                    data-display-id={group.userMessage.displayId}
                  >
                    <MessageBubble
                      message={group.userMessage}
                      prevBubbleRole={
                        groupIndex === 0
                          ? undefined
                          : (messageGroups[groupIndex - 1]?.contentMessages.at(-1)?.role ??
                            messageGroups[groupIndex - 1]?.userMessage?.role)
                      }
                      nextBubbleRole={
                        group.contentMessages[0]?.role ??
                        messageGroups[groupIndex + 1]?.userMessage?.role
                      }
                      isStreaming={false}
                    />
                  </div>
                </div>
              )}

              <div className="message-content pb-4 flex-1">
                {group.contentMessages.map((msg, i, arr) => {
                  const isLastInGroup = i === arr.length - 1;
                  const isLastRendered = isLastGroup && isLastInGroup;
                  const isStreamableRole =
                    msg.role === "agent_message" || msg.role === "agent_thought";
                  const isLastMessageStreaming = isStreaming && isLastRendered && isStreamableRole;

                  return (
                    <div
                      key={msg.displayId}
                      className="chat-message"
                      data-role={msg.role}
                      data-display-id={msg.displayId}
                    >
                      <MessageBubble
                        message={msg}
                        prevBubbleRole={i === 0 ? group.userMessage?.role : arr[i - 1]?.role}
                        nextBubbleRole={
                          isLastInGroup
                            ? messageGroups[groupIndex + 1]?.userMessage?.role
                            : arr[i + 1]?.role
                        }
                        isStreaming={isLastMessageStreaming}
                      />
                    </div>
                  );
                })}
                <div
                  className={cn(
                    "text-[11px] text-muted-foreground/50 mt-4 uppercase tracking-widest",
                    {
                      invisible: !(isLastGroup && showThinking),
                    },
                  )}
                >
                  <span className="animate-shimmer-text">
                    {t("chatArea.thinking", "Thinking...")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </ScrollArea>

      {!isAtBottom && (
        <Button
          variant="secondary"
          size="icon-sm"
          className="absolute z-10 bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-xl border border-primary/30 bg-secondary hover:bg-secondary hover:border-primary"
          onClick={scrollToBottomManual}
          aria-label={t("chatArea.scrollToBottom", "Scroll to bottom")}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
