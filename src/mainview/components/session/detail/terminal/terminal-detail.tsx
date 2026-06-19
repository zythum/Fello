import { useEffect, useRef, useCallback } from "react";
import { X, Circle } from "lucide-react";
import { request } from "../../../../backend";
import { useAppStore } from "../../../../store";
import { getOrCreateTerminalInstance } from "../../../../lib/terminal-manager";
import { cn } from "@/lib/utils";

interface TerminalDetailProps {
  terminalId: string;
  projectId: string;
  onClose: () => void;
}

export function TerminalDetail({ terminalId, projectId, onClose }: TerminalDetailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitRequestedRef = useRef(false);

  const projectStates = useAppStore((s) => s.projectStates);
  const terminal = Array.from(projectStates.values())
    .flatMap((s) => s.terminals)
    .find((t) => t.id === terminalId);

  const fitTerminal = useCallback(() => {
    const instance = getOrCreateTerminalInstance(terminalId, projectId, "");
    const container = containerRef.current;
    if (!instance || !container) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    instance.fitAddon.fit();
    void request.resizeTerminal({
      terminalId,
      cols: instance.terminal.cols,
      rows: instance.terminal.rows,
    });
  }, [terminalId, projectId]);

  useEffect(() => {
    const terminalBackground =
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--color-neutral-900")
        .trim() || "#0f0f10";

    const container = containerRef.current;
    if (!container) return;

    const instance = getOrCreateTerminalInstance(terminalId, projectId, terminalBackground);

    if (instance.terminal.element?.parentElement !== container) {
      if (!instance.terminal.element) {
        instance.terminal.open(container);
      } else {
        container.appendChild(instance.terminal.element);
      }
    }

    if (!resizeObserverRef.current) {
      const observer = new ResizeObserver(() => {
        fitTerminal();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;
    }

    // Fit after a frame to ensure layout is settled
    if (!fitRequestedRef.current) {
      fitRequestedRef.current = true;
      requestAnimationFrame(() => {
        fitTerminal();
      });
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [terminalId, projectId, fitTerminal]);

  // Re-fit on window resize
  useEffect(() => {
    const onResize = () => fitTerminal();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitTerminal]);

  // Suppress the global text context menu for the terminal,
  // letting the browser's native context menu handle copy/paste.
  // xterm.js internally moves its hidden textarea under the cursor and
  // selects the content, so the native Copy/Paste commands work correctly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      // Don't call preventDefault() — let the browser's native menu show.
      // xterm.js already sets up the hidden textarea for copy/paste.
      e.stopPropagation();
    };

    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-2 bg-background"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center min-w-0 gap-2">
          <Circle
            className={cn(
              "size-2 shrink-0",
              terminal?.running ? "fill-emerald-400 text-emerald-400" : "text-muted-foreground",
            )}
          />
          <span className="text-xs text-muted-foreground truncate">{terminalId.slice(0, 8)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* xterm container */}
      <div className="relative min-h-0 flex-1 bg-neutral-900">
        <div ref={containerRef} className="h-full w-full px-2 py-1" />
      </div>
    </div>
  );
}
