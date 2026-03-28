import type { ChatMessage } from "../store";
import { ToolGroup } from "./bubbles/tool-group";
import { ThinkingBubble } from "./bubbles/thinking-bubble";
import { UserBubble } from "./bubbles/user-bubble";
import { AssistantBubble } from "./bubbles/assistant-bubble";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  switch (message.role) {
    case "tool":
      return <ToolGroup messages={[message]} />;
    case "thinking":
      return <ThinkingBubble message={message} />;
    case "user":
      return <UserBubble message={message} />;
    case "assistant":
      return <AssistantBubble message={message} />;
    default:
      return null;
  }
}
