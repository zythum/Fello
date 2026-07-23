import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionMessages } from "../../../lib/session-selectors";
import { isValidMessageToDisplay, ChatMessage, UserMessage } from "../../../lib/chat-message";
import { MessageBubble } from "../../chat-bubbles/message-bubble";
import type { ChatTimelineItem } from "./chat-timeline";
import { ChatTimeline } from "./chat-timeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { copyText as clipboardCopyText } from "@/lib/clipboard";
import { ArrowDown, ArrowUpToLine, Check, Copy, Bot } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";

import type { SessionInfo } from "../../../../shared/schema";

/** Scroll to bottom using double-rAF to ensure browser layout is settled. */
function scrollToBottomNow(bottomEl: HTMLElement | null) {
  if (!bottomEl) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bottomEl.scrollIntoView({ block: "end", behavior: "auto" });
    });
  });
}

export function ChatArea({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const isStreaming = session.isStreaming;
  const messages = useSessionMessages(sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoScrolledOnMountRef = useRef(false);
  const userHasScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const userMessageElementRefs = useRef(new Map<string, HTMLElement>());
  const userMessageIdsRef = useRef<string[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showThinking, setShowThinking] = useState(false);
  const [activeUserMessageId, setActiveUserMessageId] = useState<string | null>(null);
  const [copiedGroupKey, setCopiedGroupKey] = useState<string | null>(null);

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
  }, [messages, isStreaming]);

  const getViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    // Mark that this scroll is programmatic so the scroll handler doesn't
    // incorrectly set userHasScrolledUpRef = true.
    isProgrammaticScrollRef.current = true;
    userHasScrolledUpRef.current = false;

    if (behavior === "smooth") {
      scrollTimeoutRef.current = setTimeout(() => {
        bottomRef.current?.scrollIntoView({ block: "end", behavior });
      }, 100);
      return;
    }

    scrollToBottomNow(bottomRef.current);
  }, []);

  const scrollToBottomAuto = useCallback(() => {
    scrollToBottom("auto");
  }, [scrollToBottom]);

  const scrollToBottomManual = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  useEffect(() => {
    const handleScrollToBottom = () => scrollToBottomManual();
    document.addEventListener("fello-scroll-to-bottom", handleScrollToBottom);
    return () => document.removeEventListener("fello-scroll-to-bottom", handleScrollToBottom);
  }, [scrollToBottomManual]);

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
      const scrollBottom = scrollHeight - scrollTop - clientHeight;
      const nextIsAtBottom = scrollBottom < 50;
      const scrollDelta = scrollTop - prevScrollTopRef.current;
      prevScrollTopRef.current = scrollTop;

      // Distinguish "user scrolled up" from "content grew, pushing viewport up".
      // If this scroll event was triggered by our own scrollToBottom, ignore it.
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false;
        // Still update isAtBottom but don't mark user as scrolled up.
        setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));
        prevScrollHeightRef.current = scrollHeight;
        return;
      }

      // Any upward movement by the user counts as an intent to read above the
      // bottom, even if still within the bottom threshold. This makes it easier
      // to break out of auto-scroll with a small mouse-wheel nudge.
      const isScrollingUp = scrollDelta <= -1;

      // If the content grew (scrollHeight increased) and the user didn't
      // actively scroll up, don't mark them as having scrolled up.
      const contentGrew = scrollHeight > prevScrollHeightRef.current;
      prevScrollHeightRef.current = scrollHeight;

      if (isScrollingUp) {
        userHasScrolledUpRef.current = true;
      } else if (!nextIsAtBottom && contentGrew && scrollBottom >= 50) {
        // Content grew enough to push us out of the "at bottom" zone.
        // This is not a user action — keep userHasScrolledUpRef as is.
      } else {
        userHasScrolledUpRef.current = !nextIsAtBottom;
      }

      setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));

      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeActiveUserMessage();
      });
    };

    const handleWheel = (e: WheelEvent) => {
      // A negative deltaY means the user is scrolling up. Treat this as an
      // immediate intent to stop auto-scrolling, even before the scroll event
      // has fired and updated the position-based heuristics.
      if (e.deltaY < 0) {
        userHasScrolledUpRef.current = true;
      }
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    handleScroll();
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      viewport.removeEventListener("wheel", handleWheel);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [getViewport]);

  // ── ResizeObserver: auto-scroll when content/viewport size changes ──
  // Observes the viewport (to catch container resize from panel layout shifts)
  // and all direct children (to catch content growth from async rendering like
  // shiki highlighting, mermaid diagrams, image loads, etc.).
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    let rafPending = false;
    const scrollIfNeeded = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!userHasScrolledUpRef.current) {
          scrollToBottomNow(bottomRef.current);
        }
      });
    };

    // Observe viewport itself — fires when the container is resized (e.g. panel layout shifts)
    const observer = new ResizeObserver(scrollIfNeeded);
    observer.observe(viewport);

    // Also observe all direct children to catch content height changes
    // (e.g. async shiki highlighting, mermaid rendering, image loads)
    for (const child of viewport.children) {
      observer.observe(child);
    }

    // Watch for new children being added (React re-renders may add/remove message groups)
    const mo = new MutationObserver((mutations) => {
      let contentChanged = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            observer.observe(node);
            contentChanged = true;
          }
        }
      }
      if (contentChanged) scrollIfNeeded();
    });
    mo.observe(viewport, { childList: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
    };
  }, [getViewport]);

  const renderedMessages = useMemo(() => {
    if (!messages) {
      return [];
    }
    return messages.filter(isValidMessageToDisplay);
  }, [messages]);

  const PAGE_SIZE = 20;

  const allMessageGroups = useMemo(() => {
    const groups: {
      key: string;
      userMessage?: UserMessage;
      contentMessages: ChatMessage[];
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

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visibleCount when session changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [sessionId]);

  const hasMore = allMessageGroups.length > visibleCount;
  const messageGroups = useMemo(
    () =>
      hasMore ? allMessageGroups.slice(allMessageGroups.length - visibleCount) : allMessageGroups,
    [allMessageGroups, visibleCount, hasMore],
  );

  const handleLoadMore = useCallback(() => {
    const viewport = getViewport();
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    setVisibleCount((prev) => prev + PAGE_SIZE);
    // After render, restore scroll position
    requestAnimationFrame(() => {
      if (!viewport) return;
      const newScrollHeight = viewport.scrollHeight;
      viewport.scrollTop += newScrollHeight - prevScrollHeight;
    });
  }, [getViewport]);

  const timelineItems = useMemo<ChatTimelineItem[]>(
    () =>
      messageGroups
        .filter((g) => g.userMessage)
        .map((g, index) => ({
          displayId: g.userMessage!.displayId,
          index: index + 1,
          content: g.userMessage!.contents.find((content) => content.type === "text")?.text ?? "",
        })),
    [messageGroups],
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
  }, [messages, isAtBottom, isStreaming, scrollToBottomAuto]);

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

  useEffect(() => {
    const handleScrollToMessage = (e: Event) => {
      const displayId = (e as CustomEvent<string>).detail;
      scrollToUserMessage(displayId);
    };
    document.addEventListener("fello-scroll-to-message", handleScrollToMessage);
    return () => document.removeEventListener("fello-scroll-to-message", handleScrollToMessage);
  }, [scrollToUserMessage]);

  const getAgentText = useCallback(
    (groupMessages: typeof renderedMessages) => {
      const parts: string[] = [];
      for (const msg of groupMessages) {
        if (msg.role !== "agent_message") {
          continue;
        }
        if (!("contents" in msg)) continue;
        const contents = msg.contents;
        if (!Array.isArray(contents)) continue;
        for (const block of contents) {
          if (block.type === "text") {
            const text = block.text.trim();
            if (text) {
              parts.push(text);
            }
          }
        }
      }
      return parts.join("\n");
    },
    [renderedMessages],
  );

  const copyText = useCallback(async (text: string) => {
    return clipboardCopyText(text);
  }, []);

  return (
    <div className="w-full relative min-h-0 flex flex-1 overflow-hidden">
      <div className="shrink-0 w-6 -mr-6 relative z-1 pointer-events-none">
        <ChatTimeline
          items={timelineItems}
          activeDisplayId={activeUserMessageId}
          onSelect={scrollToUserMessage}
        />
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 w-full transform-gpu">
        {hasMore && (
          <div className="flex items-center gap-3 px-10 py-3 max-w-5xl mx-auto">
            <div className="flex-1 border-b border-dashed border-muted-foreground/30" />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground"
              onClick={handleLoadMore}
            >
              {t("chatArea.loadMore", "Load earlier messages")}
            </Button>
            <div className="flex-1 border-b border-dashed border-muted-foreground/30" />
          </div>
        )}
        {messageGroups.map((group, groupIndex) => {
          const isFirstGroup = groupIndex === 0;
          const isLastGroup = groupIndex === messageGroups.length - 1;
          const groupText = getAgentText(group.contentMessages);
          const groupHasText = groupText.trim().length > 0;

          // 计算耗时：找出最后一条消息的时间与 userMessage 收到时间之差
          let durationMs: number | null = null;
          if (group.userMessage && group.contentMessages.length > 0) {
            const lastMsg = group.contentMessages[group.contentMessages.length - 1];
            if (lastMsg.receivedAt && group.userMessage.receivedAt) {
              const diff = lastMsg.receivedAt - group.userMessage.receivedAt;
              if (diff > 0) {
                durationMs = diff;
              }
            }
          }

          return (
            <div
              key={group.key}
              className={cn(
                "message-group max-w-5xl mx-auto flex flex-col relative pointer-events-none px-10",
                {
                  "pt-4": !isFirstGroup,
                  "min-h-full": isLastGroup,
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
                      session={session}
                      message={group.userMessage}
                      isStreaming={false}
                    />
                  </div>
                </div>
              )}

              <div className="message-content pb-4">
                <div className="flex items-center gap-1.5 mt-4 -mb-1 text-accent-foreground/90">
                  <Bot className="size-5 -translate-y-px" />
                  <span className="text-sm font-medium">{session.agentId}</span>
                </div>
                <div className="mt-6">
                  {group.contentMessages.map((msg, i, arr) => {
                    const isLastInGroup = i === arr.length - 1;
                    const isLastRendered = isLastGroup && isLastInGroup;
                    const isStreamableRole =
                      msg.role === "agent_message" || msg.role === "agent_thought";
                    const isLastMessageStreaming =
                      isStreaming && isLastRendered && isStreamableRole;

                    return (
                      <MessageBubble
                        key={msg.displayId}
                        session={session}
                        message={msg}
                        isStreaming={isLastMessageStreaming}
                      />
                    );
                  })}
                </div>
                <div
                  className={cn(
                    "text-[11px] text-muted-foreground/50 mt-4 h-4 uppercase tracking-widest",
                    {
                      invisible: !(isLastGroup && showThinking) || !isStreaming,
                    },
                  )}
                >
                  <span className="animate-shimmer-text">
                    {t("chatArea.thinking", "Thinking...")}
                  </span>
                </div>
              </div>

              {(isLastGroup ? !isStreaming : true) && (
                <div className="flex items-center relative border-b border-muted-foreground/30 border-dashed -mt-8 mb-4 group/separator pointer-events-auto">
                  <div className="flex-1 flex items-center">
                    {durationMs !== null && (
                      <span className="text-xs text-muted-foreground/50 select-none">
                        {t("chatArea.duration", { duration: formatDuration(durationMs) })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center">
                    {group.userMessage && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 bg-background hover:bg-background/80 text-muted-foreground/50 hover:text-muted-foreground/80 transition-opacity group-hover/separator:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.dispatchEvent(
                            new CustomEvent("fello-scroll-to-message", {
                              detail: group.userMessage!.displayId,
                            }),
                          );
                        }}
                        title={t("userBubble.locate", "Locate")}
                      >
                        <ArrowUpToLine className="size-3.5" />
                      </Button>
                    )}
                    {groupHasText && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 bg-background hover:bg-background/80 text-muted-foreground/50 hover:text-muted-foreground/80 transition-opacity group-hover/separator:opacity-100"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await copyText(groupText);
                          if (!ok) return;
                          setCopiedGroupKey(group.key);
                          setTimeout(
                            () => setCopiedGroupKey((prev) => (prev === group.key ? null : prev)),
                            2000,
                          );
                        }}
                        title={
                          copiedGroupKey === group.key
                            ? t("chatArea.copiedGroup", "Copied")
                            : t("chatArea.copyGroup", "Copy")
                        }
                        aria-label={
                          copiedGroupKey === group.key
                            ? t("chatArea.copiedGroup", "Copied")
                            : t("chatArea.copyGroup", "Copy")
                        }
                      >
                        {copiedGroupKey === group.key ? (
                          <Check className="size-3.5 text-green-500" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div ref={bottomRef} />
      </ScrollArea>

      {!isAtBottom && (
        <Button
          variant="secondary"
          size="icon-sm"
          className="absolute z-5 bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-xl border border-primary/30 bg-secondary hover:bg-secondary hover:border-primary"
          onClick={scrollToBottomManual}
          aria-label={t("chatArea.scrollToBottom", "Scroll to bottom")}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
