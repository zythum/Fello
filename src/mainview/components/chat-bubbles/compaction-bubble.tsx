import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, Check, X, Loader2, Ban } from "lucide-react";
import { ContentBlocks } from "../content-blocks/content-blocks";
import type { BaseBubbleProps } from "./base-bubble";
import type { CompactionMessage } from "../../lib/chat-message";

/** Map an ACP CompactionStatus to a stable i18n title key (unknown → generic). */
function titleKey(status: CompactionMessage["status"]): string {
  switch (status) {
    case "in_progress":
    case "completed":
    case "failed":
    case "cancelled":
      return `compactionBubble.title.${status}`;
    default:
      return "compactionBubble.title.unknown";
  }
}

/** Leading status icon, mirroring ToolBubble's statusIcons vocabulary. */
function statusIcon(status: CompactionMessage["status"]) {
  switch (status) {
    case "in_progress":
      return <Loader2 className="size-3 animate-spin text-primary" />;
    case "completed":
      return <Check className="size-3 text-green-400" />;
    case "failed":
      return <X className="size-3 text-destructive" />;
    case "cancelled":
      return <Ban className="size-3 text-muted-foreground" />;
    default:
      return <Archive className="size-3 text-muted-foreground" />;
  }
}

export const CompactionBubble = memo(function CompactionBubble({
  session,
  message,
  isStreaming,
}: BaseBubbleProps<CompactionMessage>) {
  const { t } = useTranslation();
  const { status, summary, error } = message;
  const hasSummary = summary.length > 0;
  const hasError = status === "failed" && !!error;
  const expandable = hasSummary || hasError;
  const [open, setOpen] = useState(false);

  return (
    <div className="compaction-bubble border border-border bg-secondary/40 rounded-md overflow-hidden pointer-events-auto my-4">
      <Collapsible
        className="text-xs min-w-0 overflow-hidden group"
        open={open && expandable}
        onOpenChange={setOpen}
      >
        <CollapsibleTrigger
          render={<div />}
          nativeButton={false}
          disabled={!expandable}
          className={cn(
            "flex select-none items-center gap-2 px-2.5 py-2",
            expandable && "hover:bg-secondary cursor-pointer",
            open && expandable && "bg-secondary/80",
          )}
        >
          <Archive className="size-3 text-muted-foreground" />
          <span className="min-w-0 flex-1 font-normal text-foreground truncate">
            {t(titleKey(status))}
          </span>
          {statusIcon(status)}
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border overflow-hidden bg-secondary/50">
          {hasError ? (
            <ScrollArea viewportClassName="max-h-[70vh]">
              <pre className="p-2 m-0 text-[11px] leading-relaxed text-destructive/80 whitespace-pre-wrap">
                <code>{error}</code>
              </pre>
            </ScrollArea>
          ) : (
            <div className="px-2 py-2">
              <ContentBlocks
                blocks={summary}
                role="compaction"
                isStreaming={isStreaming}
                session={session}
              />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});
