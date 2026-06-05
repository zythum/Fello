import { useMemo, isValidElement, useState, useCallback } from "react";
import { Streamdown, type Components } from "streamdown";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeView } from "./code-view";
import { FileIcon } from "./file-icon";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

function CodeBlock({
  language,
  highlightLang,
  codeText,
}: {
  language: string;
  highlightLang: string;
  codeText: string;
}) {
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(codeText);
    if (ok) {
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    }
  }, [codeText]);

  return (
    <div className="pt-4 pb-2">
      <div className="rounded-md border border-foreground/20 overflow-hidden relative">
        <div className="h-8 flex items-center justify-between px-1 border-b border-foreground/10 relative">
          <div className="text-muted-foreground text-xs flex items-center gap-1.5 ml-1">
            <FileIcon name={language} className="size-4" />
            <span>{language}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0 text-muted-foreground/60 hover:text-muted-foreground/80"
            onClick={handleCopy}
          >
            {hasCopied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </div>
        <CodeView content={codeText} lang={highlightLang} className="pt-8 -mt-8" />
      </div>
    </div>
  );
}

export interface StreamMarkdownProps {
  className?: string;
  isStreaming?: boolean;
  children?: string;
  forceBreaks?: boolean;
}

const FRONTMATTER_REGEX = /^---\s*([\s\S]*?)\s*---/;

const baseClasses = "max-w-none wrap-anywhere whitespace-pre-wrap";

const typographyClasses = cn(
  baseClasses,
  "prose prose-sm dark:prose-invert",
  "prose-p:leading-normal prose-p:text-foreground/90 prose-p:my-2 prose-p:text-[13px]",
  "prose-headings:text-foreground prose-headings:font-medium prose-headings:mt-2.5 prose-headings:mb-1",
  "prose-h1:text-[15px] prose-h2:text-[14px] prose-h3:text-[13px] prose-h4:text-[12px] prose-h5:text-[12px] prose-h6:text-[11px]",
  "prose-strong:text-foreground prose-strong:font-medium",
  "prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-a:no-underline prose-a:underline-offset-4 prose-a:text-[13px]",
  "prose-code:text-foreground/80 prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-normal prose-code:text-[12px]!",
  "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
  "prose-li:marker:text-muted-foreground prose-li:my-0 prose-li:text-[13px]",
  "prose-ul:pl-2 prose-ol:pl-2 prose-ul:my-1.5 prose-ol:my-1.5",
  "prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:text-[13px]",
  "prose-table:my-2 prose-th:border-border prose-td:border-border",
);

// Override the <code> element to render block code blocks with CodeView.
// The default <pre> component adds "data-block" to the <code> element via cloneElement,
// which triggers a React reconciliation — on the second render pass, the "data-block"
// prop is present, allowing us to distinguish block code from inline code.
const components: Components = {
  code: ({ className, children, node: _node, ...props }) => {
    if (!("data-block" in props)) {
      // Inline code — render as a styled <code> element
      return (
        <code
          className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
          {...props}
        >
          {children}
        </code>
      );
    }

    // Block code — extract raw source text and language, then render via CodeView
    const language = className?.match(/language-(\S+)/)?.[1] || "text";
    // Use "text" for highlighting if the language isn't supported by shiki,
    // while keeping the original language label for display in CodeBlock
    const highlightLang = language.startsWith("git") ? "text" : language;
    let codeText = "";
    if (typeof children === "string") {
      codeText = children;
    } else if (isValidElement(children)) {
      const childProps = children.props as Record<string, unknown>;
      if (typeof childProps.children === "string") {
        codeText = childProps.children;
      }
    }

    return <CodeBlock language={language} highlightLang={highlightLang} codeText={codeText} />;
  },
  table: ({ className, children, node: _node, ...props }) => (
    <Table {...props} className={cn(className, "text-xs")}>
      {children}
    </Table>
  ),
  thead: ({ className, children, node: _node, ...props }) => (
    <TableHeader {...props} className={cn(className, "border-border")}>
      {children}
    </TableHeader>
  ),
  tbody: ({ className, children, node: _node, ...props }) => (
    <TableBody {...props} className={className}>
      {children}
    </TableBody>
  ),
  tr: ({ className, children, node: _node, ...props }) => (
    <TableRow {...props} className={cn(className, "border-border")}>
      {children}
    </TableRow>
  ),
  th: ({ className, children, node: _node, ...props }) => (
    <TableHead {...props} className={cn(className, "py-2")}>
      {children}
    </TableHead>
  ),
  td: ({ className, children, node: _node, ...props }) => (
    <TableCell {...props} className={className}>
      {children}
    </TableCell>
  ),
};

export function StreamMarkdown({
  className,
  children,
  isStreaming,
  forceBreaks,
}: StreamMarkdownProps) {
  const remarkPlugins = useMemo(() => {
    return forceBreaks ? [remarkBreaks] : undefined;
  }, [forceBreaks]);

  const { frontmatter, content } = useMemo(() => {
    const matched = children?.match(FRONTMATTER_REGEX);
    if (matched) {
      const frontmatter = matched[1];
      const content = children?.slice(matched[0].length);
      return {
        frontmatter: frontmatter.trim(),
        content: content?.trim(),
      };
    }
    return { frontmatter: undefined, content: children };
  }, [children]);

  return (
    <div className={className ?? typographyClasses}>
      {frontmatter && (
        <div className="whitespace-pre-wrap text-foreground/80 rounded bg-sidebar border border-border p-2 mb-2 text-xs leading-relaxed">
          {frontmatter}
        </div>
      )}
      <Streamdown
        plugins={{ mermaid, math, cjk }}
        components={components}
        shikiTheme={["github-light", "github-dark"]}
        isAnimating={isStreaming}
        animated={{ sep: "char" }}
        linkSafety={{ enabled: false }}
        remarkPlugins={remarkPlugins}
        controls={{
          table: { fullscreen: false },
          mermaid: { fullscreen: false },
        }}
      >
        {content}
      </Streamdown>
    </div>
  );
}
