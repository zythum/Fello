import { memo } from "react";
import type { ChatMessage } from "../chat-message";
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
        />
      );
    case "system_message":
      // TODO: 实现 SystemMessage 的专属渲染气泡 (SystemBubble)
      return null;
    case "plan":
      // TODO: 实现 PlanMessage 的专属渲染面板 (PlanBubble)
      return null;
    default:
      return null;
  }
});
