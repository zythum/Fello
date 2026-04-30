import { memo, useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContentBlocks } from "../../../content-blocks/content-blocks";
import type { AgentThoughtMessage } from "../../../../lib/chat-message";
import type { BaseBubbleProps } from "./types";

export const ThinkingBubble = memo(function ThinkingBubble({
  session,
  message,
  prevBubbleRole,
  nextBubbleRole: _nextBubbleRole,
  isStreaming,
}: BaseBubbleProps<AgentThoughtMessage>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming]);

  return (
    <Collapsible
      className={cn("w-full pointer-events-auto", prevBubbleRole != null && "mt-3")}
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger className="w-full bg-transparent border-0 cursor-pointer flex select-none items-center gap-2 px-0 py-1 text-[11px] text-muted-foreground/90 hover:text-muted-foreground pointer-events-auto">
        <Lightbulb className={`size-3.5 ${isStreaming ? "animate-pulse" : ""}`} />
        <span>
          {isStreaming
            ? t("thinkingBubble.thinking", "Thinking...")
            : t("thinkingBubble.thought", "Thought")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 pl-5">
        <div className="max-w-none">
          <ContentBlocks
            blocks={message.contents}
            role={message.role}
            session={session}
            isStreaming={isStreaming}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
