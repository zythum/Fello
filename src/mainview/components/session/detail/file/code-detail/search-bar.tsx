import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, X, Search } from "lucide-react";

export interface SearchBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  matchCount: number;
  currentMatch: number;
}

export function SearchBar({
  searchTerm,
  onSearchChange,
  onNext,
  onPrev,
  onClose,
  matchCount,
  currentMatch,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="absolute top-2 right-2 z-50 flex items-center gap-1 bg-popover border border-border rounded-lg shadow-lg px-2 py-1.5">
      <Search className="size-3.5 text-muted-foreground shrink-0" />
      <Input
        ref={inputRef}
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-6 w-44 border-none bg-transparent px-1 text-[11px]! rounded-sm! focus-visible:ring-0"
        placeholder="Find..."
      />
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 select-none min-w-10 text-right">
        {matchCount > 0 ? `${currentMatch}/${matchCount}` : "0/0"}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
        aria-label="Previous match"
      >
        <ArrowUp className="size-3" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
        aria-label="Next match"
      >
        <ArrowDown className="size-3" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
        aria-label="Close search"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
