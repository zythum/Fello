import { memo } from "react";
import { Lightbulb } from "lucide-react";
import type { AgentThoughtMessage } from "../../chat-message";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "./content-blocks";

interface Props {
  message: AgentThoughtMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}

export const ThinkingBubble = memo(function ThinkingBubble({ message, prevBubbleRole }: Props) {
  return (
    <details
      className={cn("w-full px-4", prevBubbleRole != null && "mt-3")}
      open={message.streaming}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-0 py-0 text-[11px] text-muted-foreground/70 hover:text-muted-foreground">
        <Lightbulb className={`size-3.5 ${message.streaming ? "animate-pulse" : ""}`} />
        <span>{message.streaming ? "Thinking..." : "Thought"}</span>
      </summary>
      <div className="mt-1 pl-5 text-[11px] italic text-muted-foreground/60">
        <div className="max-w-none">
          <ContentBlocks blocks={message.contents} streaming={message.streaming} />
        </div>
      </div>
    </details>
  );
});
