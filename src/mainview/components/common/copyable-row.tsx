import { useState } from "react";
import { Check, Copy, FolderOpen } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { isWebUI } from "../../backend";

export function CopyableRow({
  label,
  value,
  onOpenFolder,
  openFolderTitle,
}: {
  label: string;
  value: string;
  onOpenFolder?: () => void;
  openFolderTitle?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground min-w-12">{label}:</span>
      <span className="flex-1 min-w-0 truncate font-mono text-muted-foreground/70 select-all">
        {value}
      </span>
      <button
        type="button"
        className="shrink-0 flex items-center justify-center size-5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors -mr-1"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
      {!isWebUI && onOpenFolder && (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center size-5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors -mr-1"
          onClick={onOpenFolder}
          title={openFolderTitle}
        >
          <FolderOpen className="size-3" />
        </button>
      )}
    </div>
  );
}
