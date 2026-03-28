import { memo } from "react";
import { User } from "lucide-react";
import type { ChatMessage } from "../../store";

interface Props {
  message: ChatMessage;
}

export const UserBubble = memo(function UserBubble({ message }: Props) {
  return (
    <div className="flex gap-3 justify-end items-start pl-10">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
        <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
      </div>
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary">
        <User className="size-4 text-primary-foreground" />
      </div>
    </div>
  );
});
