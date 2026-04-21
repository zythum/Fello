import { useEffect, useState, memo, useRef } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { useTheme } from "next-themes";
import type { Highlighter } from "shiki";
import {
  getShikiHighlighter,
  getShikiLanguageFromFilename,
  getShikiTheme,
} from "./shiki-highlighter";

export interface CodeCompareViewProps {
  oldContent: string;
  newContent: string;
  filename?: string;
}

export const CodeCompareView = memo(function CodeCompareView({
  oldContent,
  newContent,
  filename,
}: CodeCompareViewProps) {
  const { resolvedTheme } = useTheme();
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getShikiHighlighter().then(setHighlighter);
  }, []);

  const [containerWidth, setContainerWidth] = useState<number>(0);
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const shouldUseSplitView = containerWidth > 700;

  const renderDiffContent = (str: string) => {
    if (!highlighter || !str) return <span>{str}</span>;

    const lang = getShikiLanguageFromFilename(filename);
    const theme = getShikiTheme(resolvedTheme);

    try {
      const html = highlighter.codeToHtml(str, {
        lang,
        theme,
        structure: "inline",
      });
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    } catch {
      return <span>{str}</span>;
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full">
      <ReactDiffViewer
        oldValue={oldContent || ""}
        newValue={newContent || ""}
        splitView={shouldUseSplitView}
        useDarkTheme={resolvedTheme === "dark"}
        renderContent={renderDiffContent}
        styles={{
          variables: {
            light: {
              diffViewerBackground: "#ffffff",
              diffViewerColor: "#24292e",
            },
            dark: {
              diffViewerBackground: "#24292e",
              diffViewerColor: "#ffffff",
            },
          },
          gutter: {
            textAlign: 'right',
          },
          diffContainer: {
            minWidth: "auto",
          },
        }}
      />
    </div>
  );
});
