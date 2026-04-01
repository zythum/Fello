import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveSessionState } from "../store";
import type { ChatMessage } from "../store";
import { MessageBubble } from "./message-bubble";
import { ToolGroupBubble } from "./bubbles/tool-group-bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2, Bot, ArrowDown } from "lucide-react";

type MessageGroup =
  | { type: "message"; key: string; msg: ChatMessage }
  | { type: "tools"; key: string; msgs: ChatMessage[] };

export function ChatArea() {
  const { messages, isStreaming, activeToolCalls } = useActiveSessionState();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const getViewport = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const grouped = useMemo(() => {
    const result: MessageGroup[] = [];
    let toolBatch: ChatMessage[] = [];

    const flushTools = () => {
      if (toolBatch.length > 0) {
        result.push({
          type: "tools",
          key: `tools-${toolBatch[0].toolCallId ?? result.length}`,
          msgs: toolBatch,
        });
        toolBatch = [];
      }
    };

    for (const msg of messages) {
      if (msg.role === "tool") {
        toolBatch.push(msg);
      } else {
        flushTools();
        result.push({
          type: "message",
          key: `msg-${msg.id ?? result.length}`,
          msg,
        });
      }
    }
    flushTools();
    return result;
  }, [messages]);

  const activeToolMsgs = useMemo(() => {
    const result: ChatMessage[] = [];
    for (const [id, tc] of activeToolCalls) {
      result.push({
        role: "tool",
        content: tc.content,
        toolCallId: id,
        toolTitle: tc.title,
        toolStatus: tc.status,
        toolKind: tc.kind,
        rawInput: tc.rawInput,
        locations: tc.locations,
      });
    }
    return result;
  }, [activeToolCalls]);

  const lastMsg = messages[messages.length - 1];
  const hasStreamingContent = lastMsg?.streaming && lastMsg.role === "assistant";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls.size]);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          {grouped.map((group) =>
            group.type === "tools" ? (
              <ToolGroupBubble key={group.key} messages={group.msgs} />
            ) : (
              <MessageBubble key={group.key} message={group.msg} />
            ),
          )}

          {activeToolMsgs.length > 0 && <ToolGroupBubble messages={activeToolMsgs} />}

          {isStreaming && !hasStreamingContent && activeToolCalls.size === 0 && (
            <div className="flex gap-3 justify-start">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="size-4 text-primary" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-card px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Thinking...</span>
              </div>
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
