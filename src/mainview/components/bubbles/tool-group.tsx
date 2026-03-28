import type { ChatMessage } from "../../store";
import { ToolBubble } from "./tool-bubble";

interface Props {
  messages: ChatMessage[];
}

export function ToolGroup({ messages }: Props) {
  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border">
      {messages.map((msg, i) => (
        <ToolBubble key={msg.toolCallId ?? `tool-${i}`} message={msg} />
      ))}
    </div>
  );
}
