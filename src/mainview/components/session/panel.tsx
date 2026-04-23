import { ReactNode, useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function Panel({ open, children, className }: PanelProps) {
  const [isRendered, setIsRendered] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (open) {
      setIsRendered(true);
      // Ensure the element is rendered before triggering the animation
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setTimeout(() => {
        setIsVisible(true);
      }, 100);
    } else {
      setIsVisible(false);
      timerRef.current = setTimeout(() => setIsRendered(false), 300); // match transition duration
      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [open]);

  if (!isRendered) return null;

  return (
    <>
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 top-11 -mt-px flex flex-col border-t border-border bg-background overflow-hidden transition-transform duration-300 ease-in-out",
          isVisible ? "z-10 translate-y-0" : "z-9 translate-y-full",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
