import { memo } from "react";
import type { ChatMessage } from "../store";
import { ToolBubble } from "./bubbles/tool-bubble";
import { ThinkingBubble } from "./bubbles/thinking-bubble";
import { UserBubble } from "./bubbles/user-bubble";
import { AgentBubble } from "./bubbles/agent-bubble";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const MessageBubble = memo(function MessageBubble({
  message,
  prevBubbleRole,
  nextBubbleRole,
}: Props) {
  switch (message.role) {
    case "tool":
      return (
        <ToolBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    case "thinking":
      return (
        <ThinkingBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    case "user":
      return (
        <UserBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    case "assistant":
      return (
        <AgentBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    default:
      return null;
  }
});
