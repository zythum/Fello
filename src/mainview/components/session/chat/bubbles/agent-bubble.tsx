import { memo } from "react";
import { ContentBlocks } from "../../../content-blocks/content-blocks";
import type { AgentMessage } from "../../../../lib/chat-message";
import type { BaseBubbleProps } from "./base-bubble";

export const AgentBubble = memo(function AssistantBubble({
  session,
  message,
  isStreaming,
}: BaseBubbleProps<AgentMessage>) {
  if (!message.contents || message.contents.length === 0) {
    return null;
  }
  return (
    <div className="agent-bubble w-full pointer-events-auto my-4">
      <ContentBlocks
        blocks={message.contents}
        role={message.role}
        isStreaming={isStreaming}
        session={session}
      />
    </div>
  );
});
