import { memo } from "react";
import type { ToolCallMessage } from "../../chat-message";
import type { ToolCallStatus } from "@agentclientprotocol/sdk";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  Check,
  X,
  Loader2,
  FileText,
  Pencil,
  Trash2,
  Move,
  Search,
  Terminal,
  Brain,
  Globe,
  ArrowRightLeft,
  Wrench,
} from "lucide-react";
import { ReadonlyTerminal } from "../common/readonly-terminal";
import { ContentBlocks } from "../content-blocks/content-blocks";
import { CodeView } from "../common/code-view";
import { CodeCompareView } from "../common/code-compare-view";

const kindIcons: Record<string, React.ReactNode> = {
  read: <FileText className="size-3 text-blue-400" />,
  edit: <Pencil className="size-3 text-yellow-400" />,
  delete: <Trash2 className="size-3 text-red-400" />,
  move: <Move className="size-3 text-orange-400" />,
  search: <Search className="size-3 text-purple-400" />,
  execute: <Terminal className="size-3 text-green-400" />,
  think: <Brain className="size-3 text-cyan-400" />,
  fetch: <Globe className="size-3 text-sky-400" />,
  switch_mode: <ArrowRightLeft className="size-3 text-pink-400" />,
  other: <Wrench className="size-3 text-muted-foreground" />,
};

const statusIcons: Record<ToolCallStatus, React.ReactNode> = {
  pending: <Loader2 className="size-3 text-muted-foreground" />,
  in_progress: <Loader2 className="size-3 animate-spin text-primary" />,
  completed: <Check className="size-3 text-green-400" />,
  failed: <X className="size-3 text-destructive" />,
};

interface ToolItemProps {
  message: ToolCallMessage;
}

export const ToolItem = memo(function ToolItem({ message }: ToolItemProps) {
  const { t } = useTranslation();
  const status: ToolCallStatus = message.status ?? "completed";
  const isLive = status === "in_progress" || status === "pending";
  const kindIcon = message.kind ? kindIcons[message.kind] : null;

  return (
    <details
      className="text-xs min-w-0 overflow-hidden"
      open={isLive || message.terminalId != null}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
        {kindIcon}
        <span className="flex-1 font-normal text-foreground">
          {message.title || t("toolBubble.tool")}
        </span>
        {statusIcons[status]}
      </summary>
      <div className="border-t border-border overflow-hidden">
        {message.locations && message.locations.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-border">
            {message.locations.map((loc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <FileText className="size-2.5" />
                {loc.path.split("/").pop()}
                {loc.line != null && `:${loc.line}`}
              </span>
            ))}
          </div>
        )}
        {message.content &&
          message.content.map((content, index) => {
            if (content.type === "content") {
              return (
                <div key={index} className="px-3 py-2 text-muted-foreground">
                  <ContentBlocks blocks={[content.content]} role="tool_call"></ContentBlocks>
                </div>
              );
            } else if (content.type === "diff") {
              return (
                <div
                  key={index}
                  className="h-64 border-b border-border last:border-b-0 flex flex-col"
                >
                  <div className="px-3 py-1 bg-muted/50 border-b border-border text-[10px] font-mono text-muted-foreground truncate">
                    {content.path}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {content.oldText == null ? (
                      <CodeView
                        content={content.newText}
                        filename={content.path.split("/").pop()}
                      />
                    ) : (
                      <CodeCompareView
                        oldContent={content.oldText}
                        newContent={content.newText}
                        filename={content.path.split("/").pop()}
                      />
                    )}
                  </div>
                </div>
              );
            }
            return null;
          })}
        {message.terminalId && <ReadonlyTerminal terminalId={message.terminalId} />}
        {message.rawInput != null && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
            {typeof message.rawInput === "string"
              ? message.rawInput
              : JSON.stringify(message.rawInput, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
});

interface ToolBubbleProps {
  message: ToolCallMessage;
  prevBubbleRole?: string;
  nextBubbleRole?: string;
}

export const ToolBubble = memo(function ToolBubble({
  message,
  prevBubbleRole,
  nextBubbleRole,
}: ToolBubbleProps) {
  const isGroupedWithPrev = prevBubbleRole === "tool_call";
  const isGroupedWithNext = nextBubbleRole === "tool_call";
  const hasPrevBubble = prevBubbleRole != null;

  return (
    <div
      className={cn(
        "tool-bubble border border-border bg-card rounded-none",
        !isGroupedWithPrev && hasPrevBubble && "mt-4",
        isGroupedWithPrev && "-mt-px",
        !isGroupedWithPrev && "rounded-t-md",
        !isGroupedWithNext && "rounded-b-md",
      )}
    >
      <ToolItem message={message} />
    </div>
  );
});
