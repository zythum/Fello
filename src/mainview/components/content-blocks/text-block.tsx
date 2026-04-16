import { memo } from "react";
import { cn } from "@/lib/utils";
import type { TextContent } from "@agentclientprotocol/sdk";
import type { SessionInfo } from "../../../shared/schema";
import type { ChatMessage } from "../../chat-message";
import { StreamMarkdown } from "../common/stream-markdown";

interface TextBlockProps {
  block: TextContent;
  role: ChatMessage["role"];
  session?: SessionInfo;
  isStreaming?: boolean;
}

const baseClasses = "max-w-none break-words whitespace-pre-wrap";

const typographyClasses: Record<string, string> = {
  agent_thought: cn(
    baseClasses,
    "prose dark:prose-invert",
    "prose-p:text-[11px] prose-p:leading-normal prose-p:text-muted-foreground/60 prose-p:italic prose-p:m-0 prose-p:mb-1.5",
    "prose-headings:text-muted-foreground/70 prose-headings:font-medium prose-headings:mt-1.5 prose-headings:mb-1",
    "prose-h1:text-[13px] prose-h2:text-[12px] prose-h3:text-[11px] prose-h4:text-[11px] prose-h5:text-[11px] prose-h6:text-[11px]",
    "prose-strong:text-muted-foreground/70 prose-strong:font-medium",
    "prose-a:text-blue-500/70 dark:prose-a:text-blue-400/70 prose-a:underline-offset-4 hover:prose-a:underline",
    "prose-code:text-muted-foreground/70 prose-code:bg-muted/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal",
    "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
    "prose-li:marker:text-muted-foreground/50 prose-li:text-[11px] prose-li:text-muted-foreground/60 prose-li:py-[px]",
    "prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-ul:pl-1 prose-ol:pl-1",
    "prose-blockquote:border-l-border prose-blockquote:text-muted-foreground/60 prose-blockquote:text-[11px]",
  ),
  user_message: cn(
    baseClasses,
    "prose prose-sm dark:prose-invert",
    "prose-p:leading-snug prose-p:text-card-foreground/75 prose-p:m-0 prose-p:text-[13px]",
    "prose-headings:text-card-foreground prose-headings:font-medium prose-headings:mt-2.5 prose-headings:mb-1",
    "prose-h1:text-[15px] prose-h2:text-[14px] prose-h3:text-[13px] prose-h4:text-[12px] prose-h5:text-[12px] prose-h6:text-[11px]",
    "prose-strong:text-card-foreground prose-strong:font-medium",
    "prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-a:underline-offset-4 hover:prose-a:underline prose-a:text-[13px]",
    "prose-code:text-card-foreground prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:text-[12px]",
    "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
    "prose-li:my-0 prose-li:text-[13px]",
    "prose-ul:pl-2 prose-ol:pl-2 prose-ul:my-1.5 prose-ol:my-1.5",
  ),
  agent_message: cn(
    baseClasses,
    "prose prose-sm dark:prose-invert",
    "prose-p:leading-snug prose-p:text-foreground/90 prose-p:my-1.5 prose-p:text-[13px]",
    "prose-headings:text-foreground prose-headings:font-medium prose-headings:mt-2.5 prose-headings:mb-1",
    "prose-h1:text-[15px] prose-h2:text-[14px] prose-h3:text-[13px] prose-h4:text-[12px] prose-h5:text-[12px] prose-h6:text-[11px]",
    "prose-strong:text-foreground prose-strong:font-medium",
    "prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-4 prose-a:text-[13px]",
    "prose-code:text-foreground prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-normal prose-code:text-[12px]",
    "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
    "prose-li:marker:text-muted-foreground prose-li:my-0 prose-li:text-[13px]",
    "prose-ul:pl-2 prose-ol:pl-2 prose-ul:my-1.5 prose-ol:my-1.5",
    "prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:text-[13px]",
    "prose-th:border-border prose-td:border-border",
  ),
  fallback: cn(
    baseClasses,
    "prose prose-sm dark:prose-invert",
    "prose-p:leading-snug prose-p:text-card-foreground/75 prose-p:m-0 prose-p:text-[13px]",
    "prose-headings:text-card-foreground prose-headings:font-medium prose-headings:mt-2.5 prose-headings:mb-1",
    "prose-h1:text-[15px] prose-h2:text-[14px] prose-h3:text-[13px] prose-h4:text-[12px] prose-h5:text-[12px] prose-h6:text-[11px]",
    "prose-strong:text-card-foreground prose-strong:font-medium",
    "prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-a:underline-offset-4 hover:prose-a:underline prose-a:text-[13px]",
    "prose-code:text-card-foreground prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:text-[12px]",
    "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
    "prose-li:my-0 prose-li:text-[13px]",
    "prose-ul:pl-2 prose-ol:pl-2 prose-ul:my-1.5 prose-ol:my-1.5",
  ),
};

export const TextBlock = memo(function TextBlock({
  block,
  role,
  session: _session,
  isStreaming,
}: TextBlockProps) {
  // UserBubble 中原有的 text 解析和路径识别功能被移除了，现在所有的渲染都交由 TextBlock 负责
  let className =
    role in typographyClasses ? typographyClasses[role] : typographyClasses["fallback"];
  return (
    <div className={className}>
      <StreamMarkdown isStreaming={isStreaming} forceBreaks={role === "user_message"}>
        {block.text}
      </StreamMarkdown>
    </div>
  );
});
