import { memo, useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { File } from "@pierre/diffs/react";
import type { SelectedLineRange } from "@pierre/diffs";
import { shikiPreloadPromise, isShikiReady } from "@/lib/shiki-preload";

const unsafeCSS = `
:host{--diffs-font-size:12px;user-select:text;}
::highlight(file-search-all) {
  background-color: #f59e0b80;
  color: inherit;
}

::highlight(file-search-current) {
  background-color: #f59e0b;
  color: #000;
}
`;

export interface CodeViewProps {
  className?: string;
  content: string;
  filename?: string;
  addLineToChat?: boolean;
}

export const CodeView = memo(function CodeView({
  className,
  content,
  filename,
  addLineToChat,
}: CodeViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [highlighterReady, setHighlighterReady] = useState(isShikiReady());
  const readyRef = useRef(highlighterReady);

  // Ensure Shiki is fully initialized before rendering File.
  // The preload was already started at app startup; we just wait for it if needed.
  useEffect(() => {
    if (readyRef.current) return;
    let cancelled = false;
    shikiPreloadPromise.then(() => {
      if (!cancelled) {
        readyRef.current = true;
        setHighlighterReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!highlighterReady) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-4 text-xs text-muted-foreground",
          className,
        )}
      >
        Loading syntax highlighter...
      </div>
    );
  }

  const onGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => {
      if (addLineToChat && filename) {
        const position =
          range.start === range.end ? `:${range.start}` : `:${range.start}-${range.end}`;

        document.dispatchEvent(
          new CustomEvent("fello-add-to-chat", {
            detail: [{ id: filename, name: filename + position, isFolder: false }],
          }),
        );
      }
    },
    [addLineToChat, filename],
  );

  return (
    <File
      className={className}
      file={{ name: filename ?? "file", contents: content || "" }}
      options={{
        theme: isDark ? "github-dark" : "github-light",
        themeType: isDark ? "dark" : "light",
        unsafeCSS,
        disableFileHeader: true,
        enableLineSelection: Boolean(filename) && addLineToChat,
        enableGutterUtility: Boolean(filename) && addLineToChat,
        onGutterUtilityClick,
      }}
    />
  );
});
