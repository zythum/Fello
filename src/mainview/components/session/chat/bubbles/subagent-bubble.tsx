import { memo, useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  ChevronsDownUp,
  ChevronsUpDown,
  Check,
  X,
  Loader2,
  Ellipsis,
  MessageSquareQuote,
  MessageSquareMore,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubagentMessage } from "../../../../lib/chat-message";
import type { SubagentStatus } from "../../../../../shared/schema";
import { ToolBubble } from "./tool-bubble";
import { ThinkingBubble } from "./thinking-bubble";
import { AgentBubble } from "./agent-bubble";
import { PlanBubble } from "./plan-bubble";
import type { BaseBubbleProps } from "./base-bubble";
import { StreamMarkdown } from "../../../common/stream-markdown";

const statusIcons: Record<SubagentStatus, React.ReactNode> = {
  pending: <Ellipsis className="size-3 text-muted-foreground" />,
  in_progress: <Loader2 className="size-3 animate-spin text-primary" />,
  completed: <Check className="size-3 text-green-400" />,
  failed: <X className="size-3 text-destructive" />,
};

const typographyClasses = cn(
  "max-w-none wrap-anywhere whitespace-pre-wrap",
  "prose dark:prose-invert",
  "prose-p:text-[11px] prose-p:leading-normal prose-p:text-muted-foreground/70 prose-p:m-0 prose-p:mb-1.5",
  "prose-headings:text-muted-foreground/70 prose-headings:font-medium prose-headings:mt-1.5 prose-headings:mb-1",
  "prose-h1:text-[13px] prose-h2:text-[12px] prose-h3:text-[11px] prose-h4:text-[11px] prose-h5:text-[11px] prose-h6:text-[11px]",
  "prose-strong:text-muted-foreground/70 prose-strong:font-medium",
  "prose-a:text-blue-500/70 dark:prose-a:text-blue-400/70 prose-a:underline-offset-4",
  "prose-code:text-muted-foreground/70 prose-code:bg-muted/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:text-[11px]!",
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
  "prose-li:marker:text-muted-foreground/70 prose-li:text-[11px] prose-li:text-muted-foreground/70 prose-li:py-px",
  "prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-ul:pl-1 prose-ol:pl-1",
  "prose-table:my-2 prose-th:border-border prose-td:border-border",
  "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground/60 prose-blockquote:text-[11px]",
  "prose-hr:my-4",
);

type SubchatMessage = SubagentMessage["messages"][number];
const MessageBubble = memo(function MessageBubble({
  session,
  message,
  isStreaming,
}: BaseBubbleProps<SubchatMessage>) {
  switch (message.role) {
    case "tool_call":
      return <ToolBubble session={session} message={message} isStreaming={isStreaming} />;
    case "agent_thought":
      return <ThinkingBubble session={session} message={message} isStreaming={isStreaming} />;
    case "agent_message":
      return <AgentBubble session={session} message={message} isStreaming={isStreaming} />;
    case "plan":
      return <PlanBubble session={session} message={message} isStreaming={isStreaming} />;
    default:
      return null;
  }
});

export const SubagentBubble = memo(function SubagentBubble({
  session,
  message,
  isStreaming: _isStreaming,
}: BaseBubbleProps<SubagentMessage>) {
  const status: SubagentStatus = message.status ?? "completed";
  const userAction = useRef<boolean>(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (userAction.current === true) {
      return;
    }
    if (message.status === "in_progress") {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [message.status]);

  const toggle = useCallback(() => {
    userAction.current = true;
    setOpen((open) => !open);
  }, []);

  return (
    <div className="subagent-bubble w-full pointer-events-auto pt-2 my-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4" />
          <div>
            <span className="text-xs">{message.name}</span>
          </div>
          <button className="text-muted-foreground/80 hover:text-muted-foreground" onClick={toggle}>
            {open ? <ChevronsUpDown className="size-3" /> : <ChevronsDownUp className="size-3" />}
          </button>
          <div className="flex-1"></div>
          <div className="mr-3">{statusIcons[status]}</div>
        </div>
      </div>
      <div className="pl-4 ml-2 pt-1 border-l border-dashed">
        <div className="flex items-start gap-2 pb-4 mt-2 -mb-2 relative min-h-6">
          <MessageSquareQuote className="size-4 absolute top-px -left-6 bg-background text-muted-foreground/70 scale-70" />
          <StreamMarkdown className={typographyClasses} isStreaming={false}>
            {message.prompt}
          </StreamMarkdown>
        </div>
        <div className="relative">
          <div className="h-2 border-b border-dashed -ml-4 mt-px -mb-1" />
          {open && (<>
            <MessageSquareMore className="size-4 absolute top-6 -left-6 bg-background text-muted-foreground/70 scale-70" />
            {message.messages.map((message, index) => {
              return (
                <MessageBubble
                  key={index}
                  session={session}
                  message={message}
                  isStreaming={status !== "completed"}
                />
              );
            })}
            <div className="border-b border-dashed -ml-4 -mb-1" />
          </>
          )}
        </div>
      </div>
    </div>
  );
});
