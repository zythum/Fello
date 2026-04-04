import { memo } from "react";
import type { ChatMessage } from "../../store";
import { cn } from "@/lib/utils";
import { StreamMarkdown } from "./stream-markdown";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const AgentBubble = memo(function AssistantBubble({ message, prevBubbleRole }: Props) {
  if (!message.content) {
    return null;
  }
  return (
    <div
      className={cn(
        "w-full px-4 text-[13px] leading-relaxed font-normal text-foreground/75",
        prevBubbleRole != null && "mt-4",
      )}
    >
      <StreamMarkdown streaming={message.streaming}>{message.content}</StreamMarkdown>
    </div>
  );
});
