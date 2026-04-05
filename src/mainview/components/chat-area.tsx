import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveSessionState } from "../store";
import { MessageBubble } from "./message-bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

export function ChatArea() {
  const { messages, isStreaming, activeToolCalls } = useActiveSessionState();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<any>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const getViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRafRef.current) {
      clearTimeout(scrollRafRef.current);
    }
    scrollRafRef.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        clearTimeout(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getViewport]);

  const lastMsg = messages[messages.length - 1];
  const hasStreamingContent = lastMsg?.streaming && lastMsg.role === "assistant";

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeToolCalls.size, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="py-4 max-w-3xl mx-auto">
          {messages
            .filter((message) => {
              if (message.role === "assistant" && !message.content) {
                return false;
              }
              return true;
            })
            .map((msg, i, messages) => (
              <div
                key={msg.id ?? msg.toolCallId ?? `msg-${i}`}
                className="chat-message"
                data-role={msg.role}
              >
                <MessageBubble
                  message={msg}
                  prevBubbleRole={messages[i - 1]?.role}
                  nextBubbleRole={messages[i + 1]?.role}
                />
              </div>
            ))}

          {isStreaming && !hasStreamingContent && activeToolCalls.size === 0 && (
            <div className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
              <span>Thinking...</span>
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
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
