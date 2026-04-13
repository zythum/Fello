import { memo } from "react";
import type { SystemMessage } from "../../chat-message";

interface Props {
  message: SystemMessage;
}

export const SystemBubble = memo(function SystemBubble({ message }: Props) {
  const { kind, contents } = message;

  return (
    <div className="flex w-full flex-col items-center justify-center py-2 gap-2">
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
                ? "px-3 py-0.5 text-center max-w-[80%] break-words bg-muted/30 rounded-full border border-border/40"
                : kind === "warning"
                  ? "text-xs text-warning/80 bg-warning/10 px-3 py-1 rounded-md text-center max-w-[80%] break-words"
                  : "text-xs text-destructive/80 bg-destructive/10 px-3 py-1 rounded-md text-center max-w-[80%] break-words"
            }
          >
            {text}
          </div>
        ))}
      </div>
    </div>
  );
});
