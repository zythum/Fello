import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { stringify as toYamlString } from "json-to-pretty-yaml";
import { ReadonlyTerminal } from "../../../common/readonly-terminal";
import { ContentBlocks } from "../../../content-blocks/content-blocks";
import { CodeView } from "../../../common/code-view";
import { CodeCompareView } from "../../../common/code-compare-view";
import type { ToolCallMessage } from "../../../../lib/chat-message";
import type { ToolCallStatus } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../../../shared/schema";
import type { BaseBubbleProps } from "./types";

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
  session: SessionInfo;
  message: ToolCallMessage;
}

export function ToolItem({ session, message }: ToolItemProps) {
  const { t } = useTranslation();
  const activeProjectId = session.projectId;
  const status: ToolCallStatus = message.status ?? "completed";
  const kindIcon = message.kind ? kindIcons[message.kind] : null;
  return (
    <details
      className="text-xs min-w-0 overflow-hidden group"
      open={(message.content && message.content.length > 0) || message.terminalId != null}
    >
      <summary className="flex select-none items-center gap-2 px-2.5 py-2 hover:bg-secondary group-open:bg-secondary">
        {kindIcon}
        <span className="min-w-0 flex-1 font-normal text-foreground truncate">
          {message.title || t("toolBubble.tool")}
        </span>
        {message.locations && message.locations.length > 0 && (
          <div className="flex min-w-0 max-w-[45%] flex-nowrap items-center justify-end gap-1 overflow-x-auto">
            {message.locations.map((loc, i) => {
              const fileName = loc.path.split("/").pop() ?? loc.path;
              const label = `${fileName}${loc.line != null ? `:${loc.line}` : ""}`;
              return (
                <Button
                  key={i}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="shrink-0 h-5 gap-1 rounded px-1.5 font-normal text-secondary-foreground/80 hover:text-secondary-foreground"
                  title={loc.path}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!activeProjectId) return;
                    document.dispatchEvent(
                      new CustomEvent("fello-preview-file", {
                        detail: { projectId: activeProjectId, relativePath: loc.path },
                      }),
                    );
                  }}
                >
                  <FileText className="size-2.5" />
                  <span className="max-w-40 truncate">{label}</span>
                </Button>
              );
            })}
          </div>
        )}
        {statusIcons[status]}
      </summary>
      <div className="border-t border-border overflow-hidden bg-secondary/50">
        {message.content &&
          message.content.map((content, index) => {
            if (content.type === "content") {
              return (
                <div key={index} className="px-2 text-muted-foreground">
                  <ContentBlocks blocks={[content.content]} role="tool_call"></ContentBlocks>
                </div>
              );
            } else if (content.type === "diff") {
              return (
                <div key={index} className="border-b border-border last:border-b-0 flex flex-col">
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
        {(!message.content || message.content.length === 0) && message.rawInput != null && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all p-2 text-[10px] leading-relaxed text-muted-foreground">
            {typeof message.rawInput === "string"
              ? message.rawInput
              : toYamlString(message.rawInput)}
          </pre>
        )}
      </div>
    </details>
  );
}

export function ToolBubble({
  session,
  message,
  prevBubbleRole,
  nextBubbleRole,
  isStreaming: _isStreaming,
}: BaseBubbleProps<ToolCallMessage>) {
  const isGroupedWithPrev = prevBubbleRole === "tool_call";
  const isGroupedWithNext = nextBubbleRole === "tool_call";
  const hasPrevBubble = prevBubbleRole != null;

  return (
    <div
      className={cn(
        "tool-bubble border border-border bg-secondary/40 rounded-none overflow-hidden pointer-events-auto",
        !isGroupedWithPrev && hasPrevBubble && "mt-4",
        isGroupedWithPrev && "-mt-px",
        !isGroupedWithPrev && "rounded-t-md",
        !isGroupedWithNext && "rounded-b-md",
      )}
    >
      <ToolItem session={session} message={message} />
    </div>
  );
}
