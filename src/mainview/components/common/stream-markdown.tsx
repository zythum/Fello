import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";

export interface StreamMarkdownProps {
  isStreaming?: boolean;
  children?: string;
}

export function StreamMarkdown({ children, isStreaming }: StreamMarkdownProps) {
  return (
    <Streamdown
      plugins={{ code, mermaid, math, cjk }}
      shikiTheme={["github-light", "github-dark"]}
      isAnimating={isStreaming}
      animated={{ sep: "char" }}
      linkSafety={{ enabled: false }}
    >
      {children}
    </Streamdown>
  );
}
