import { memo } from "react";
import type { ChatMessage } from "../chat-message";
import { ToolBubble } from "./bubbles/tool-bubble";
import { ThinkingBubble } from "./bubbles/thinking-bubble";
import { UserBubble } from "./bubbles/user-bubble";
import { AgentBubble } from "./bubbles/agent-bubble";
import { SystemBubble } from "./bubbles/system-bubble";
import { PlanBubble } from "./bubbles/plan-bubble";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
  isStreaming?: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  prevBubbleRole,
  nextBubbleRole,
  isStreaming,
}: Props) {
  switch (message.role) {
    case "tool_call":
      return (
        <ToolBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    case "agent_thought":
      return (
        <ThinkingBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "user_message":
      return (
        <UserBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    case "agent_message":
      return (
        <AgentBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "system_message":
      return <SystemBubble message={message} />;
    case "plan":
      return (
        <PlanBubble
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
        />
      );
    default:
      return null;
  }
});
