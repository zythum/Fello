import { memo } from "react";
import type { SystemMessage } from "../../../lib/chat-message";
import type { BaseBubbleProps } from "./types";

export const SystemBubble = memo(function SystemBubble({
  session: _session,
  message,
  prevBubbleRole: _prevBubbleRole,
  nextBubbleRole: _nextBubbleRole,
  isStreaming: _isStreaming,
}: BaseBubbleProps<SystemMessage>) {
  const { kind, contents } = message;

  return (
    <div className="flex w-full flex-col items-center justify-center py-2 gap-2 pointer-events-auto">
      <div
        className={
          kind === "info"
            ? "flex flex-col items-center gap-1 text-[10px] text-muted-foreground/40 font-mono select-none"
            : "flex flex-col items-center gap-1"
        }
      >
        {contents.map((text, i) => (
          <div
            key={i}
            className={
              kind === "info"
                ? "px-3 py-0.5 text-center max-w-[80%] bg-muted/30 rounded-full border border-border/40"
                : kind === "warning"
                  ? "text-xs text-warning/80 bg-warning/10 px-3 py-1 rounded-md text-center max-w-[80%]"
                  : "text-xs text-destructive/80 bg-destructive/10 px-3 py-1 rounded-md text-center max-w-[80%]"
            }
          >
            {text}
          </div>
        ))}
      </div>
    </div>
  );
});
