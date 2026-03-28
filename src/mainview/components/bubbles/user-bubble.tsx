import { User } from "lucide-react";
import type { ChatMessage } from "../../store";

interface Props {
  message: ChatMessage;
}

export function UserBubble({ message }: Props) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
        <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
      </div>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary">
        <User className="size-4 text-primary-foreground" />
      </div>
    </div>
  );
}
