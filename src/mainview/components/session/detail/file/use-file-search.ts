import { useEffect, useRef, useCallback, useState } from "react";
import { useSearchHighlight } from "../../../common/use-search-highlight";

export interface UseFileSearchResult {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  matchCount: number;
  currentMatch: number;
  goToNext: () => void;
  goToPrev: () => void;
  /** Ref to attach to the code view container for DOM-based search */
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function useFileSearch(
  projectId: string | null,
  file: string | null,
  viewMode: string,
): UseFileSearchResult {
  const [searchOpen, setSearchOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const {
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    reset: resetSearch,
  } = useSearchHighlight(searchOpen ? contentRef.current : null);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    resetSearch();
  }, [resetSearch]);

  // Close search when file or view mode changes (DOM content changes invalidate old ranges)
  useEffect(() => {
    setSearchOpen(false);
    resetSearch();
  }, [projectId, file, viewMode, resetSearch]);

  // Ctrl+F / Cmd+F to open search, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        if (searchOpen) {
          // Re-mount the SearchBar to refocus input
          setSearchOpen(false);
          requestAnimationFrame(() => setSearchOpen(true));
        } else {
          openSearch();
        }
      }
      if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, openSearch, closeSearch]);

  return {
    searchOpen,
    openSearch,
    closeSearch,
    searchTerm,
    setSearchTerm,
    matchCount,
    currentMatch,
    goToNext,
    goToPrev,
    contentRef,
  };
}
