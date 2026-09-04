import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@/lib/utils"

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  hideScrollBar?: boolean
}

function ScrollArea({
  className,
  viewportClassName,
  children,
  hideScrollBar,
  ...props
}: ScrollAreaProps) {
  const handleViewportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    // Respect handlers that already claimed the event or another element that owns focus.
    if (
      event.defaultPrevented ||
      event.target !== viewport ||
      viewport.ownerDocument.activeElement !== viewport
    ) {
      return;
    }

    const isMetaEdgeShortcut =
      event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const isPlainEdgeShortcut =
      !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    let top: number | null = null;

    if (isMetaEdgeShortcut && event.key === "ArrowUp") {
      top = 0;
    } else if (isMetaEdgeShortcut && event.key === "ArrowDown") {
      top = viewport.scrollHeight;
    } else if (isPlainEdgeShortcut && event.key === "Home") {
      top = 0;
    } else if (isPlainEdgeShortcut && event.key === "End") {
      top = viewport.scrollHeight;
    }

    if (top === null) return;

    event.preventDefault();
    viewport.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn("size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:outline-1", viewportClassName)}
        style={{ overflowAnchor: "auto" }}
        onKeyDown={handleViewportKeyDown}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {hideScrollBar ? null : <ScrollBar />}
      {hideScrollBar ? null : <ScrollAreaPrimitive.Corner />}
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-1 select-none opacity-0 pointer-events-none transition-[opacity,color] data-hovering:opacity-50 data-hovering:pointer-events-auto data-scrolling:opacity-50 data-scrolling:pointer-events-auto data-horizontal:h-3.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-3.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
