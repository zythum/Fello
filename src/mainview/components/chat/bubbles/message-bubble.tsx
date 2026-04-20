import { memo } from "react";
import { ToolBubble } from "./tool-bubble";
import { ThinkingBubble } from "./thinking-bubble";
import { UserBubble } from "./user-bubble";
import { AgentBubble } from "./agent-bubble";
import { SystemBubble } from "./system-bubble";
import { PlanBubble } from "./plan-bubble";
import type { ChatMessage } from "../../../lib/chat-message";
import type { BaseBubbleProps } from "./types";

export const MessageBubble = memo(function MessageBubble({
  session,
  message,
  prevBubbleRole,
  nextBubbleRole,
  isStreaming,
}: BaseBubbleProps<ChatMessage>) {
  switch (message.role) {
    case "tool_call":
      return (
        <ToolBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "agent_thought":
      return (
        <ThinkingBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "user_message":
      return (
        <UserBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "agent_message":
      return (
        <AgentBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "system_message":
      return (
        <SystemBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    case "plan":
      return (
        <PlanBubble
          session={session}
          message={message}
          prevBubbleRole={prevBubbleRole}
          nextBubbleRole={nextBubbleRole}
          isStreaming={isStreaming}
        />
      );
    default:
      return null;
  }
});
