import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import remarkBreaks from "remark-breaks";
import { useMemo } from "react";

export interface StreamMarkdownProps {
  isStreaming?: boolean;
  children?: string;
  forceBreaks?: boolean;
}

export function StreamMarkdown({ children, isStreaming, forceBreaks }: StreamMarkdownProps) {
  const remarkPlugins = useMemo(() => {
    return forceBreaks ? [remarkBreaks] : undefined;
  }, [forceBreaks]);

  return (
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
  );
}
