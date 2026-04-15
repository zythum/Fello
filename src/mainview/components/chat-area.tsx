import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActiveSessionState } from "../store";
import { isValidMessageToDisplay } from "../chat-message";
import { MessageBubble } from "./message-bubble";
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
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showThinking, setShowThinking] = useState(false);

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

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const nextIsAtBottom = scrollHeight - scrollTop - clientHeight < 40;
      userHasScrolledUpRef.current = !nextIsAtBottom;
      setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getViewport]);

  const renderedMessages = messages.filter(isValidMessageToDisplay);

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

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="py-4 max-w-3xl mx-auto">
          {renderedMessages.map((msg, i, arr) => {
            const isLastRendered = i === arr.length - 1;
            const isStreamableRole = msg.role === "agent_message" || msg.role === "agent_thought";
            const isLastMessageStreaming = isStreaming && isLastRendered && isStreamableRole;

            return (
              <div key={msg.displayId} className="chat-message" data-role={msg.role}>
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
