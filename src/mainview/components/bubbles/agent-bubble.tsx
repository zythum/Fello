import { memo } from "react";
import type { AgentMessage } from "../../chat-message";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { useAppStore } from "../../store";

interface Props {
  message: AgentMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
  isStreaming?: boolean;
}

export const AgentBubble = memo(function AssistantBubble({
  message,
  prevBubbleRole,
  isStreaming,
}: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === activeSessionId));

  if (!message.contents || message.contents.length === 0) {
    return null;
  }
  return (
    <div className={cn("w-full", prevBubbleRole != null && "mt-4")}>
      <ContentBlocks
        blocks={message.contents}
        role={message.role}
        session={session}
        isStreaming={isStreaming}
      />
    </div>
  );
});
