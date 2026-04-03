import { memo } from "react";
import type { ChatMessage } from "../../store";
import { cn } from "@/lib/utils";

interface Props {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const UserBubble = memo(function UserBubble({ message, prevBubbleRole }: Props) {
  return (
    <div className={cn("flex justify-end px-4", prevBubbleRole != null && "mt-4")}>
      <div className="max-w-[80%] rounded-2xl rounded-br-md border border-border bg-secondary px-4 py-3 text-xs leading-relaxed font-normal text-card-foreground">
        <p className="whitespace-pre-wrap wrap-break-word font-normal">{message.content}</p>
      </div>
    </div>
  );
});
