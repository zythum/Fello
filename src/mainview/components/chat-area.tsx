import { useEffect, useRef } from "react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";

const code = createCodePlugin({
  themes: ["github-light", "tokyo-night"],
});
import { useAppStore } from "../store";
import { MessageBubble } from "./message-bubble";
import { ToolCallIndicator } from "./tool-call-indicator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Lightbulb, Bot } from "lucide-react";

export function ChatArea() {
  const {
    messages,
    isStreaming,
    streamingContent,
    thinkingContent,
    activeToolCalls,
  } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, thinkingContent, activeToolCalls.size]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? `msg-${i}`} message={msg} />
        ))}

        {/* Thinking */}
        {isStreaming && thinkingContent && (
          <details className="w-full" open>
            <summary className="flex cursor-pointer select-none items-center gap-2 rounded-t-lg bg-muted/50 px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
              <Lightbulb className="size-3.5 animate-pulse" />
              <span>Thinking...</span>
            </summary>
            <div className="rounded-b-lg border-t border-border bg-muted/30 px-4 py-3 text-sm italic text-muted-foreground">
              <div className="prose prose-invert prose-sm max-w-none opacity-70">
                <Streamdown plugins={{ code }} isAnimating={true}>
                  {thinkingContent}
                </Streamdown>
              </div>
            </div>
          </details>
        )}

        {/* Tool calls */}
        <ToolCallIndicator toolCalls={activeToolCalls} />

        {/* Streaming response */}
        {isStreaming && streamingContent && (
          <div className="flex gap-3 justify-start">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bot className="size-4 text-primary" />
            </div>
            <div className="w-full rounded-2xl rounded-bl-md bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground">
              <div className="prose prose-invert prose-sm max-w-none [&_pre]:rounded-lg [&_pre]:bg-muted [&_code]:text-primary">
                <Streamdown plugins={{ code }} isAnimating={true}>
                  {streamingContent}
                </Streamdown>
              </div>
            </div>
          </div>
        )}

        {/* Loading dots */}
        {isStreaming && !streamingContent && activeToolCalls.size === 0 && (
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
    </div>
  );
}
