import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { Lightbulb } from "lucide-react";
import type { ChatMessage } from "../../store";

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

interface Props {
  message: ChatMessage;
}

export function ThinkingBubble({ message }: Props) {
  return (
    <details className="w-full px-10" open={message.streaming}>
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-t-lg bg-muted/50 px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
        <Lightbulb className={`size-3.5 ${message.streaming ? "animate-pulse" : ""}`} />
        <span>{message.streaming ? "Thinking..." : "Thought"}</span>
      </summary>
      <div className="rounded-b-lg border-t border-border bg-muted/30 px-4 py-3 text-sm italic text-muted-foreground">
        <div className="max-w-none opacity-70">
          <Streamdown
            plugins={{ code }}
            shikiTheme={["github-light", "github-dark"]}
            isAnimating={message.streaming}
          >
            {message.content}
          </Streamdown>
        </div>
      </div>
    </details>
  );
}
