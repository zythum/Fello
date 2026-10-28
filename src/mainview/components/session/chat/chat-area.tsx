import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useSessionActiveSubagents,
  useSessionHistoryPagination,
  useSessionMessages,
} from "../../../lib/session-selectors";
import { isValidMessageToDisplay, ChatMessage, UserMessage } from "../../../lib/chat-message";
import { MessageBubble } from "../../chat-bubbles/message-bubble";
import type { ChatTimelineItem } from "./chat-timeline";
import { ChatTimeline } from "./chat-timeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { copyText as clipboardCopyText } from "@/lib/clipboard";
import { speakOnce } from "../../../lib/tts/tts-reader";
import { ArrowDown, ArrowUpToLine, Check, Copy, Bot, Volume2 } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useFocusTarget } from "../../../lib/keyboard";
import { loadPreviousSessionHistory } from "../../../lib/session-lifecycle";

import { HISTORY_PAGE_SIZE } from "../../../../shared/constants";

import type { SessionInfo } from "../../../../shared/schema";

function ChatAreaImpl({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const isStreaming = session.isStreaming;
  const messages = useSessionMessages(sessionId);
  const activeSubagents = useSessionActiveSubagents(sessionId);
  const { previousSegmentId } = useSessionHistoryPagination(sessionId);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const isLoadingEarlierRef = useRef(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const userMessageElementRefs = useRef(new Map<string, HTMLElement>());
  const userMessageIdsRef = useRef<string[]>([]);
  // 吸附底部交给 use-stick-to-bottom：它用 ResizeObserver 跟踪内容尺寸、用速度弹簧动画
  // 跟随流式追加，并自行区分「用户滚动」与「程序滚动」，不再需要手写的阈值与 ref 启发式。
  const { scrollRef, contentRef, scrollToBottom, stopScroll, isAtBottom } = useStickToBottom({
    resize: "instant",
    initial: "instant",
  });
  const [showThinking, setShowThinking] = useState(false);
  const [activeUserMessageId, setActiveUserMessageId] = useState<string | null>(null);
  const [copiedGroupKey, setCopiedGroupKey] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: any = null;
    // eslint-disable-next-line react/set-state-in-effect
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

  const focusChatArea = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    viewport.focus({ preventScroll: true });
  }, [getViewport]);
  useFocusTarget("chat-area", focusChatArea);

  const scrollToBottomManual = useCallback(() => {
    void scrollToBottom({ animation: "smooth" });
  }, [scrollToBottom]);

  useEffect(() => {
    const handleScrollToBottom = () => scrollToBottomManual();
    document.addEventListener("fello-scroll-to-bottom", handleScrollToBottom);
    return () => document.removeEventListener("fello-scroll-to-bottom", handleScrollToBottom);
  }, [scrollToBottomManual]);

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

  const renderedMessages = useMemo(() => {
    if (!messages) {
      return [];
    }
    return messages.filter(isValidMessageToDisplay);
  }, [messages]);

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

  // 与后端消息分段阈值共用同一常量。
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setVisibleCount(HISTORY_PAGE_SIZE);
  }, [sessionId]);

  const hiddenGroupCount = Math.max(0, allMessageGroups.length - visibleCount);
  const hasCachedMore = hiddenGroupCount > 0;
  const shouldLoadPreviousSegment =
    previousSegmentId !== undefined && hiddenGroupCount < HISTORY_PAGE_SIZE;
  const hasMore = hasCachedMore || previousSegmentId !== undefined;
  const messageGroups = useMemo(
    () =>
      hasCachedMore
        ? allMessageGroups.slice(Math.max(0, allMessageGroups.length - visibleCount))
        : allMessageGroups,
    [allMessageGroups, hasCachedMore, visibleCount],
  );

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || isLoadingEarlierRef.current) return;

    const viewport = getViewport();
    const prevScrollHeight = viewport?.scrollHeight ?? 0;
    const revealNextPage = () => {
      setVisibleCount((count) => count + HISTORY_PAGE_SIZE);
      // Wait for React to prepend the newly visible groups before restoring the viewport anchor.
      requestAnimationFrame(() => {
        if (!viewport) return;
        // 上方插入内容会让 stick 逻辑重新计算目标位置，先停掉动画再手动补回偏移。
        stopScroll();
        viewport.scrollTop += viewport.scrollHeight - prevScrollHeight;
      });
    };

    if (!shouldLoadPreviousSegment) {
      revealNextPage();
      return;
    }

    isLoadingEarlierRef.current = true;
    setIsLoadingEarlier(true);
    try {
      const loaded = await loadPreviousSessionHistory(sessionId);
      if (loaded) revealNextPage();
    } catch (error) {
      console.error("Failed to load earlier session history", error);
    } finally {
      isLoadingEarlierRef.current = false;
      setIsLoadingEarlier(false);
    }
  }, [getViewport, hasMore, sessionId, shouldLoadPreviousSegment, stopScroll]);

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
  // userMessageIdsRef 只在滚动计算回调中读取，因此在 effect 阶段同步最新值
  useEffect(() => {
    userMessageIdsRef.current = timelineDisplayIds;
  }, [timelineDisplayIds]);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setActiveUserMessageId((prev) => prev ?? firstTimelineDisplayId);
    const viewport = getViewport();
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.dispatchEvent(new Event("scroll"));
    });
  }, [firstTimelineDisplayId, timelineDisplayIdsKey, getViewport]);

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
      // 先中止吸附动画，否则它会把这次跳转拽回底部。
      stopScroll();
      viewport.scrollTo({ top: Math.max(0, elTop), behavior: "smooth" });
    },
    [getViewport, stopScroll],
  );

  useEffect(() => {
    const handleScrollToMessage = (e: Event) => {
      const displayId = (e as CustomEvent<string>).detail;
      scrollToUserMessage(displayId);
    };
    document.addEventListener("fello-scroll-to-message", handleScrollToMessage);
    return () => document.removeEventListener("fello-scroll-to-message", handleScrollToMessage);
  }, [scrollToUserMessage]);

  const getAgentText = useCallback((groupMessages: typeof renderedMessages) => {
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
  }, []);

  const copyText = useCallback(async (text: string) => {
    return clipboardCopyText(text);
  }, []);

  return (
    <div className="w-full relative min-h-0 flex flex-1 group/chat-area">
      <div className="shrink-0 w-6 -mr-6 relative z-1 pointer-events-none">
        <ChatTimeline
          items={timelineItems}
          activeDisplayId={activeUserMessageId}
          onSelect={scrollToUserMessage}
        />
      </div>

      <ScrollArea
        ref={scrollAreaRef}
        viewportRef={scrollRef}
        className="flex-1 w-full transform-gpu"
        viewportClassName="animate-in fade-in chat-area [container-type:size]"
      >
        {/* contentRef 供 use-stick-to-bottom 用 ResizeObserver 跟踪内容尺寸变化 */}
        <div ref={contentRef} className="min-h-full">
          {hasMore && (
            <div className="flex w-full items-center gap-3 px-10 py-3 max-w-5xl mx-auto">
              <div className="flex-1 border-b border-dashed border-muted-foreground/30" />
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground"
                disabled={isLoadingEarlier}
                onClick={() => void handleLoadMore()}
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

            // 最后一条消息如果是尚未完成的工具调用，则显示「等待任务完成」而不是「思考中」
            const lastGroupMessage = group.contentMessages[group.contentMessages.length - 1];
            const isWaitingForTask =
              lastGroupMessage?.role === "tool_call" &&
              (lastGroupMessage.status === "in_progress" || lastGroupMessage.status === "pending");
            const isWaitingForSubagent = Array.from(activeSubagents?.values() ?? []).some(
              (subagent) => subagent.status === "in_progress" || subagent.status === "pending",
            );

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
                  "message-group w-full max-w-5xl mx-auto flex flex-col relative pointer-events-none px-10",
                  {
                    "pt-4": !isFirstGroup,
                    // 最后一条消息组至少撑满一屏。视口是 size 容器（见 ScrollArea 的
                    // viewportClassName），所以这里的 cqh 等于滚动视口高度，而不是内容
                    // 包裹层的高度 —— 后者的高度是 auto，百分比 min-height 会算成 0。
                    // 不能用 flex-1：内容已超出视口时没有空闲空间可分，最后组会退回内容高度。
                    "min-h-[100cqh]": isLastGroup,
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
                        invisible:
                          !isLastGroup ||
                          !isStreaming ||
                          (!showThinking && !isWaitingForTask && !isWaitingForSubagent),
                      },
                    )}
                  >
                    <span className="animate-shimmer-text">
                      {isWaitingForTask
                        ? t("chatArea.waitingForTask", "Waiting for task...")
                        : isWaitingForSubagent
                          ? t("chatArea.waitingForSubagent", "Waiting for subagent...")
                          : t("chatArea.thinking", "Thinking...")}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            speakOnce(groupText);
                          }}
                          title={t("chat.readAloud", "Read aloud")}
                          aria-label={t("chat.readAloud", "Read aloud")}
                        >
                          <Volume2 className="size-3.5" />
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
        </div>
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

      <div className="pointer-events-none absolute -top-px left-0 right-0 h-px bg-linear-to-r from-ring/30 from-10% via-ring/80 via-30% to-ring/30 animate-out fill-mode-both fade-out ease-out duration-1500 hidden group-has-[.chat-area:focus-visible]/chat-area:block"></div>
    </div>
  );
}

export const ChatArea = memo(ChatAreaImpl);
