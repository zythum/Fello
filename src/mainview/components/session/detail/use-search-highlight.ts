import { useState, useEffect, useRef, useCallback } from "react";

const HIGHLIGHT_ALL = "file-search-all";
const HIGHLIGHT_CURRENT = "file-search-current";

function scrollToRange(range: Range) {
  const node = range.startContainer;
  let el: Element | null = null;
  if (node.nodeType === Node.TEXT_NODE) {
    el = node.parentElement;
  } else if (node instanceof Element) {
    el = node;
  }
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function useSearchHighlight(containerEl: HTMLElement | null) {
  const [searchTerm, setSearchTerm] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  const currentMatchRef = useRef(0);

  // Keep currentMatchRef in sync
  currentMatchRef.current = currentMatch;

  const clearHighlights = useCallback(() => {
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }, []);

  // Perform search when term or container changes
  useEffect(() => {
    clearHighlights();
    rangesRef.current = [];

    if (!searchTerm || !containerEl) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const term = searchTerm.toLowerCase();
    const allRanges: Range[] = [];

    const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const lowerText = text.toLowerCase();
      let idx = 0;
      while ((idx = lowerText.indexOf(term, idx)) !== -1) {
        const range = new Range();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        allRanges.push(range);
        idx += term.length;
      }
    }

    rangesRef.current = allRanges;
    setMatchCount(allRanges.length);

    if (allRanges.length > 0) {
      setCurrentMatch(1);
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...allRanges));
      CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(allRanges[0]));
      scrollToRange(allRanges[0]);
    } else {
      setCurrentMatch(0);
    }

    return () => clearHighlights();
  }, [searchTerm, containerEl, clearHighlights]);

  // Update current match highlight
  const updateCurrentHighlight = useCallback((index: number) => {
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
    const ranges = rangesRef.current;
    if (ranges.length > 0 && index > 0 && index <= ranges.length) {
      const range = ranges[index - 1];
      CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(range));
      scrollToRange(range);
    }
  }, []);

  const goToNext = useCallback(() => {
    setCurrentMatch((prev) => {
      const newIdx = prev < rangesRef.current.length ? prev + 1 : 1;
      updateCurrentHighlight(newIdx);
      return newIdx;
    });
  }, [updateCurrentHighlight]);

  const goToPrev = useCallback(() => {
    setCurrentMatch((prev) => {
      const newIdx = prev > 1 ? prev - 1 : rangesRef.current.length;
      updateCurrentHighlight(newIdx);
      return newIdx;
    });
  }, [updateCurrentHighlight]);

  // When searchTerm changes externally (e.g. cleared), reset
  const reset = useCallback(() => {
    setSearchTerm("");
    clearHighlights();
    rangesRef.current = [];
    setMatchCount(0);
    setCurrentMatch(0);
  }, [clearHighlights]);

  return {
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    reset,
  };
}
