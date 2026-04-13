import { memo } from "react";
import { Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentThoughtMessage } from "../../chat-message";
import { cn } from "@/lib/utils";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { useAppStore } from "../../store";

interface Props {
  message: AgentThoughtMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
  isStreaming?: boolean;
}

export const ThinkingBubble = memo(function ThinkingBubble({ message, prevBubbleRole, isStreaming }: Props) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === activeSessionId));

  return (
    <details
      className={cn("w-full px-4", prevBubbleRole != null && "mt-3")}
      open={isStreaming}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-0 py-1 text-[11px] text-muted-foreground/90 hover:text-muted-foreground">
        <Lightbulb className={`size-3.5 ${isStreaming ? "animate-pulse" : ""}`} />
        <span>
          {isStreaming
            ? t("thinkingBubble.thinking", "Thinking...")
            : t("thinkingBubble.thought", "Thought")}
        </span>
      </summary>
      <div className="mt-1 pl-5">
        <div className="max-w-none">
          <ContentBlocks
            blocks={message.contents}
            role={message.role}
            session={session}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </details>
  );
});
