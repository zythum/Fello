import * as React from "react";
import { useEffect, useState } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
import { DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";
import { Copy, Scissors, ClipboardPaste, Type } from "lucide-react";
import { useTranslation } from "react-i18next";

export function GlobalTextContextMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ getBoundingClientRect: () => DOMRect } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [isEditable, setIsEditable] = useState(false);
  const handleOpenChange: NonNullable<MenuPrimitive.Root.Props["onOpenChange"]> = (
    nextOpen,
    eventDetails,
  ) => {
    if (nextOpen) {
      setOpen(true);
      return;
    }

    const reason = eventDetails.reason;
    if (reason === "outside-press" || reason === "escape-key" || reason === "item-press") {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      const target = e.target as HTMLElement;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest('[data-slot="context-menu-trigger"]')
      ) {
        return;
      }
      e.preventDefault();

      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target && target.isContentEditable);

      setAnchor({
        getBoundingClientRect: () =>
          DOMRect.fromRect({
            x: e.clientX,
            y: e.clientY,
            width: 0,
            height: 0,
          }),
      });

      requestAnimationFrame(() => {
        const selection = window.getSelection()?.toString() || "";
        const nextHasSelection = selection.trim().length > 0;
        const nextIsEditable = editable;
        if (!nextHasSelection && !nextIsEditable) {
          setOpen(false);
          return;
        }
        setHasSelection(nextHasSelection);
        setIsEditable(nextIsEditable);
        setOpen(true);
      });
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  if (!open) return null;

  return (
    <MenuPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={anchor}
          className="isolate z-50 outline-none"
          side="bottom"
          align="start"
        >
          <MenuPrimitive.Popup
            className={cn(
              "z-50 max-h-(--available-height) min-w-38 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover py-1 px-1 space-y-0.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            {isEditable && (
              <DropdownMenuItem
                onClick={() => {
                  document.execCommand("cut");
                  setOpen(false);
                }}
              >
                <Scissors />
                {t("contextMenu.cut", "Cut")}
              </DropdownMenuItem>
            )}
            {(hasSelection || isEditable) && (
              <DropdownMenuItem
                onClick={() => {
                  document.execCommand("copy");
                  setOpen(false);
                }}
              >
                <Copy />
                {t("contextMenu.copy", "Copy")}
              </DropdownMenuItem>
            )}
            {isEditable && (
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    document.execCommand("insertText", false, text);
                  } catch (e) {
                    console.error("Failed to read clipboard contents: ", e);
                  }
                  setOpen(false);
                }}
              >
                <ClipboardPaste />
                {t("contextMenu.paste", "Paste")}
              </DropdownMenuItem>
            )}
            {isEditable && <DropdownMenuSeparator />}
            {isEditable && (
              <DropdownMenuItem
                onClick={() => {
                  document.execCommand("selectAll");
                  setOpen(false);
                }}
              >
                <Type />
                {t("contextMenu.selectAll", "Select All")}
              </DropdownMenuItem>
            )}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
