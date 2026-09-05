import { ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Command, Option } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShortcutKeysProps {
  shortcut: string;
  isMac: boolean;
  className?: string;
}

function ShortcutPart({ part, isMac }: { part: string; isMac: boolean }) {
  if (part === "Mod") {
    return isMac ? <Command className="size-3.5" /> : <span>Ctrl</span>;
  }
  if (part === "Ctrl") return <span>Ctrl</span>;
  if (part === "Alt") return isMac ? <Option className="size-3.5" /> : <span>Alt</span>;
  if (part === "Shift") return <ArrowBigUp className="size-3.5" />;
  if (part === "ArrowUp") return <ArrowUp className="size-3.5" />;
  if (part === "ArrowDown") return <ArrowDown className="size-3.5" />;
  if (part === "ArrowLeft") return <ArrowLeft className="size-3.5" />;
  if (part === "ArrowRight") return <ArrowRight className="size-3.5" />;

  const symbolLabels: Record<string, string> = {
    Plus: "+",
    Minus: "-",
  };

  return <span>{symbolLabels[part] ?? part}</span>;
}

export function ShortcutKeys({ shortcut, isMac, className }: ShortcutKeysProps) {
  const parts = shortcut.split("+").filter(Boolean);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-label={shortcut}>
      {parts.map((part, index) => (
        <kbd
          key={`${part}-${index}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted/60 px-1.5 text-[11px] font-medium text-foreground/80 shadow-xs"
        >
          <ShortcutPart part={part} isMac={isMac} />
        </kbd>
      ))}
    </span>
  );
}
