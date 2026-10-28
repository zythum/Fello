import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import type { Ref } from "react"

import { cn } from "@/lib/utils"

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  /** 转交给 Viewport（滚动元素）的 ref，供需要直接操作滚动的 hook 使用。 */
  viewportRef?: Ref<HTMLDivElement>;
  hideScrollBar?: boolean
}

function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  children,
  hideScrollBar,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      {/* Edge scrolling (Cmd/Ctrl + ArrowUp/Down) is intentionally left to the browser:
          Chromium scrolls the focused viewport on its own, so no key handler is needed. */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn("size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:outline-1", viewportClassName)}
        style={{ overflowAnchor: "auto" }}
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
