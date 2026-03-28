import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { Bot } from "lucide-react";
import type { ChatMessage } from "../../store";

const code = createCodePlugin({
  themes: ["github-light", "tokyo-night"],
});

interface Props {
  message: ChatMessage;
}

export function AssistantBubble({ message }: Props) {
  return (
    <div className="flex gap-3 justify-start">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="size-4 text-primary" />
      </div>
      <div className="w-full rounded-2xl rounded-bl-md bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground">
        <div className="prose prose-invert prose-sm max-w-none [&_pre]:rounded-lg [&_pre]:bg-muted [&_code]:text-primary">
          <Streamdown plugins={{ code }} isAnimating={message.streaming}>
            {message.content}
          </Streamdown>
        </div>
      </div>
    </div>
  );
}
