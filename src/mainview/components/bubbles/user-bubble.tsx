import { memo } from "react";
import type { ChatMessage } from "../../store";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const UserBubble = memo(function UserBubble({ message, prevBubbleRole }: Props) {
  return (
    <div className="px-4 flex flex-col">
      {prevBubbleRole != null && <div className="my-14 h-px bg-border" />}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md border border-border bg-secondary px-4 py-3 text-sm leading-relaxed font-normal text-card-foreground">
          <p className="whitespace-pre-wrap wrap-break-word font-normal">{message.content}</p>
        </div>
      </div>
    </div>
  );
});
