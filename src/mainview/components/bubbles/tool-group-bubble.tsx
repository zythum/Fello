import type { ChatMessage } from "../../store";
import { ToolItem } from "./tool-bubble";

interface Props {
  messages: ChatMessage[];
}

export function ToolGroupBubble({ messages }: Props) {
  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border mx-10">
      {messages.map((msg, i) => (
        <ToolItem key={msg.toolCallId ?? `tool-${i}`} message={msg} />
      ))}
    </div>
  );
}
