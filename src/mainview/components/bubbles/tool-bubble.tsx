import { memo } from "react";
import type { ChatMessage, ToolStatus } from "../../store";
import { Badge } from "@/components/ui/badge";
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
import { ReadonlyTerminal } from "../readonly-terminal";

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

const statusIcons: Record<ToolStatus, React.ReactNode> = {
  pending: <Loader2 className="size-3 text-muted-foreground" />,
  in_progress: <Loader2 className="size-3 animate-spin text-primary" />,
  completed: <Check className="size-3 text-green-400" />,
  failed: <X className="size-3 text-destructive" />,
};

interface ToolItemProps {
  message: ChatMessage;
}

export const ToolItem = memo(function ToolItem({ message }: ToolItemProps) {
  const { t } = useTranslation();
  const status: ToolStatus = message.toolStatus ?? "completed";
  const isLive = status === "in_progress" || status === "pending";
  const kindIcon = message.toolKind ? kindIcons[message.toolKind] : null;

  return (
    <details className="text-xs min-w-0 overflow-hidden" open={isLive}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
        {statusIcons[status]}
        {kindIcon}
        <span className="font-medium text-foreground">
          {message.toolTitle || t("toolBubble.tool")}
        </span>
        {message.toolKind && (
          <Badge variant="outline" className="text-[10px]">
            {message.toolKind}
          </Badge>
        )}
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
        {message.rawInput != null && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
            {typeof message.rawInput === "string"
              ? message.rawInput
              : JSON.stringify(message.rawInput, null, 2)}
          </pre>
        )}
        {message.terminalId && (
          <div className="px-3 pb-2 pt-1">
            <ReadonlyTerminal terminalId={message.terminalId} />
          </div>
        )}
        {message.content && !message.rawInput && !message.terminalId && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 text-muted-foreground">
            {message.content.slice(0, 500)}
            {message.content.length > 500 && "..."}
          </pre>
        )}
      </div>
    </details>
  );
});

interface ToolBubbleProps {
  message: ChatMessage;
  prevBubbleRole?: ChatMessage["role"];
  nextBubbleRole?: ChatMessage["role"];
}

export const ToolBubble = memo(function ToolBubble({
  message,
  prevBubbleRole,
  nextBubbleRole,
}: ToolBubbleProps) {
  const isGroupedWithPrev = prevBubbleRole === "tool";
  const isGroupedWithNext = nextBubbleRole === "tool";
  const hasPrevBubble = prevBubbleRole != null;

  return (
    <div
      className={cn(
        "tool-bubble mx-4 border border-border bg-card rounded-none",
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
