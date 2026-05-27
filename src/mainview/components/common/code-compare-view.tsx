import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
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

export interface CodeCompareViewProps {
  className?: string;
  oldContent: string;
  newContent: string;
  filename?: string;
  addLineToChat?: boolean;
  diffStyle?: "split" | "unified" | undefined;
}

export function CodeCompareView({
  className,
  oldContent,
  newContent,
  filename,
  addLineToChat,
  diffStyle,
}: CodeCompareViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
  const [fallbackDiffStyle, setFallbackDiffStyle] = useState<"split" | "unified">(
    diffStyle ?? "unified",
  );
  const [highlighterReady, setHighlighterReady] = useState(() => isShikiReady());
  const readyRef = useRef(highlighterReady);

  // Ensure Shiki is fully initialized before rendering FileDiff.
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

  useEffect(() => {
    if (!headerEl) return;

    const callback = () => {
      setFallbackDiffStyle(headerEl.offsetWidth > 800 ? "split" : "unified");
    };
    callback();
    const observer = new ResizeObserver(callback);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [headerEl]);

  const diff = useMemo(
    () =>
      parseDiffFromFile(
        { name: filename ?? "old", contents: oldContent || "" },
        { name: filename ?? "new", contents: newContent || "" },
      ),
    [oldContent, newContent, filename],
  );

  // While Shiki is still loading, render a minimal placeholder
  // so the collapsible panel has content height.
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
    <FileDiff
      fileDiff={diff}
      className={className}
      renderCustomHeader={() => <div ref={setHeaderEl} className="h-2"></div>}
      options={{
        theme: isDark ? "github-dark" : "github-light",
        themeType: isDark ? "dark" : "light",
        diffStyle: diffStyle ?? fallbackDiffStyle,
        unsafeCSS,
        enableLineSelection: addLineToChat,
        enableGutterUtility: addLineToChat,
        onGutterUtilityClick,
      }}
    />
  );
}
