import { memo } from "react";
import type { ChatMessage } from "../store";
import { ToolBubble } from "./bubbles/tool-bubble";
import { ThinkingBubble } from "./bubbles/thinking-bubble";
import { UserBubble } from "./bubbles/user-bubble";
import { AssistantBubble } from "./bubbles/assistant-bubble";

interface Props {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: Props) {
  switch (message.role) {
    case "tool":
      return <ToolBubble message={message} />;
    case "thinking":
      return <ThinkingBubble message={message} />;
    case "user":
      return <UserBubble message={message} />;
    case "assistant":
      return <AssistantBubble message={message} />;
    default:
      return null;
  }
});
