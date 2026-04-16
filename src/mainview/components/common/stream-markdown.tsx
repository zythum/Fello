import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import remarkBreaks from "remark-breaks";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface StreamMarkdownProps {
  isStreaming?: boolean;
  children?: string;
  forceBreaks?: boolean;
}
const baseClasses = "max-w-none break-words whitespace-pre-wrap";

const typographyClasses = cn(
  baseClasses,
  "prose prose-sm dark:prose-invert",
  "prose-p:leading-normal prose-p:text-foreground/90 prose-p:my-2 prose-p:text-[13px]",
  "prose-headings:text-foreground prose-headings:font-medium prose-headings:mt-2.5 prose-headings:mb-1",
  "prose-h1:text-[15px] prose-h2:text-[14px] prose-h3:text-[13px] prose-h4:text-[12px] prose-h5:text-[12px] prose-h6:text-[11px]",
  "prose-strong:text-foreground prose-strong:font-medium",
  "prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-4 prose-a:text-[13px]",
  "prose-code:text-foreground/80 prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-normal prose-code:text-[12px]!",
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
  "prose-li:marker:text-muted-foreground prose-li:my-0 prose-li:text-[13px]",
  "prose-ul:pl-2 prose-ol:pl-2 prose-ul:my-1.5 prose-ol:my-1.5",
  "prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:text-[13px]",
  "prose-th:border-border prose-td:border-border",
);

export function StreamMarkdown({ children, isStreaming, forceBreaks }: StreamMarkdownProps) {
  const remarkPlugins = useMemo(() => {
    return forceBreaks ? [remarkBreaks] : undefined;
  }, [forceBreaks]);

  return (
    <div className={typographyClasses}>
      <Streamdown
        plugins={{ code, mermaid, math, cjk }}
        shikiTheme={["github-light", "github-dark"]}
        isAnimating={isStreaming}
        animated={{ sep: "char" }}
        linkSafety={{ enabled: false }}
        remarkPlugins={remarkPlugins}
      >
        {children}
      </Streamdown>
    </div>
  );
}
