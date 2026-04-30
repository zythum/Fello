import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function Panel({ open, children, className }: PanelProps) {
  const [isRendered, setIsRendered] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const durationMs = 350;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (open) {
      setIsRendered(true);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      timerRef.current = setTimeout(() => setIsRendered(false), durationMs);
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open]);

  if (!isRendered) return null;

  return (
    <>
      <div
        className={cn(
          "absolute inset-0 flex -m-px flex-col border-t border-l border-border bg-background overflow-hidden transition-all duration-350 ease-in-out",
          isVisible
            ? "z-10 translate-y-0 min-[1400px]:translate-y-0 min-[1400px]:translate-x-0"
            : "z-9 translate-y-full min-[1400px]:translate-y-0 min-[1400px]:translate-x-full",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
