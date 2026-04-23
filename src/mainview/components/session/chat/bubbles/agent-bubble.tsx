import { memo } from "react";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "../../../content-blocks/content-blocks";
import type { AgentMessage } from "../../../../lib/chat-message";
import type { BaseBubbleProps } from "./types";

export const AgentBubble = memo(function AssistantBubble({
  session,
  message,
  prevBubbleRole,
  nextBubbleRole: _nextBubbleRole,
  isStreaming,
}: BaseBubbleProps<AgentMessage>) {
  if (!message.contents || message.contents.length === 0) {
    return null;
  }
  return (
    <div className={cn("w-full pointer-events-auto", prevBubbleRole != null && "mt-4")}>
      <ContentBlocks
        blocks={message.contents}
        role={message.role}
        isStreaming={isStreaming}
        session={session}
      />
    </div>
  );
});
