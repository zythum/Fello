import { memo } from "react";
import { ToolBubble } from "./tool-bubble";
import { ThinkingBubble } from "./thinking-bubble";
import { UserBubble } from "./user-bubble";
import { AgentBubble } from "./agent-bubble";
import { SystemBubble } from "./system-bubble";
import { PlanBubble } from "./plan-bubble";
import { SubagentBubble } from "./subagent-bubble";
import type { BaseBubbleProps } from "./base-bubble";
import type { ChatMessage } from "../../../../lib/chat-message";

export const MessageBubble = memo(function MessageBubble({
  session,
  message,
  isStreaming,
}: BaseBubbleProps<ChatMessage>) {
  switch (message.role) {
    case "tool_call":
      return <ToolBubble session={session} message={message} isStreaming={isStreaming} />;
    case "agent_thought":
      return <ThinkingBubble session={session} message={message} isStreaming={isStreaming} />;
    case "user_message":
      return <UserBubble session={session} message={message} isStreaming={isStreaming} />;
    case "agent_message":
      return <AgentBubble session={session} message={message} isStreaming={isStreaming} />;
    case "system_message":
      return <SystemBubble session={session} message={message} isStreaming={isStreaming} />;
    case "plan":
      return <PlanBubble session={session} message={message} isStreaming={isStreaming} />;
    case "subagent":
      return <SubagentBubble session={session} message={message} isStreaming={isStreaming} />;
    default:
      return null;
  }
});
