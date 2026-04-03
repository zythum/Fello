import { memo } from "react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import type { ChatMessage } from "../../store";
import { cn } from "@/lib/utils";

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

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
    <div className={cn("w-full px-4 text-xs leading-relaxed font-normal text-foreground", prevBubbleRole != null && "mt-4")}>
      <Streamdown
        className="max-w-none font-normal"
        plugins={{ code }}
        shikiTheme={["github-light", "github-dark"]}
        isAnimating={message.streaming}
      >
        {message.content}
      </Streamdown>
    </div>
  );
});
