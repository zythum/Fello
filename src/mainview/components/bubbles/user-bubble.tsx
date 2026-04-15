import { memo } from "react";
import type { UserMessage } from "../../chat-message";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { useAppStore } from "../../store";

interface Props {
  message: UserMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}

export const UserBubble = memo(function UserBubble({ message, prevBubbleRole }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === activeSessionId));

  return (
    <div className="flex flex-col">
      {prevBubbleRole != null && <div className="my-14 h-px bg-border" />}
      <div className="flex justify-end">
        <div className="min-w-12 max-w-[80%] rounded-3xl rounded-tr-sm border border-border bg-secondary px-2 py-2 text-[13px] leading-snug font-normal text-card-foreground/75">
          <ContentBlocks blocks={message.contents} role={message.role} session={session} />
        </div>
      </div>
    </div>
  );
});
