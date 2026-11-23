import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { request } from "../../backend";
import { useAppStore } from "../../store";
import { StreamMarkdown } from "../common/stream-markdown";
import { ErrorState, LoadingState } from "../session/detail/file/common/loading-state";

/** The assistant's long-term memory (memory.md), maintained by Dream. */
export function MemoryDetail({
  assistantId,
  compact,
  onClose,
}: {
  assistantId: string;
  compact: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = compact && isMacApp && !isFullScreen;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void request
      .readAssistantMemory({ assistantId })
      .then((result) => {
        if (active) setContent(result.content);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [assistantId]);

  const hasContent = content !== null && content.trim().length > 0;

  return (
    <div className="flex flex-col w-full h-full min-w-0 relative overflow-hidden">
      <div
        className={cn(
          "h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background transition-[padding]",
          !compact ? "" : sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
        )}
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <div className="min-w-0 flex items-center gap-1.5">
            <Brain className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs truncate leading-tight text-foreground/60">
                {t("assistant.memory.title", "Memory")}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {error ? (
          <ErrorState message={error} />
        ) : content === null ? (
          <LoadingState />
        ) : hasContent ? (
          <ScrollArea className="w-full h-full">
            <div className="prose prose-sm dark:prose-invert max-w-none p-6 min-h-full bg-background font-sans pb-20">
              <StreamMarkdown>{content}</StreamMarkdown>
            </div>
          </ScrollArea>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("assistant.memory.empty", "No memory yet")}
          </p>
        )}
      </div>
    </div>
  );
}
