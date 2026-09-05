import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, SquareTerminal, X, Circle, Eye, Trash2 } from "lucide-react";
import { request, clientId } from "../../../../backend";
import { useAppStore, useProjectState } from "../../../../store";
import { destroyTerminalInstance } from "../../../../lib/terminal-manager";
import { useFocusTarget } from "../../../../lib/keyboard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

interface TerminalPanelProps {
  projectId: string;
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
}

type TerminalNavigationItem = { type: "add" } | { type: "terminal"; id: string };

const ADD_TERMINAL_NAVIGATION_ID = "__add_terminal__";

function terminalNavigationItemKey(item: TerminalNavigationItem) {
  return item.type === "add" ? ADD_TERMINAL_NAVIGATION_ID : item.id;
}

export function TerminalPanel({
  projectId,
  activeTerminalId,
  onSelectTerminal,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  const projectState = useProjectState(projectId);
  const terminals = projectState.terminals;
  const updateProjectState = useAppStore((s) => s.updateProjectState);
  const navigationItemRefs = useRef(new Map<string, HTMLElement>());
  const focusedNavigationItemIdRef = useRef<string | null>(null);
  const navigationItems = useMemo<TerminalNavigationItem[]>(() => {
    const items: TerminalNavigationItem[] = [{ type: "add" }];
    items.push(
      ...terminals.map(
        (terminal): TerminalNavigationItem => ({ type: "terminal", id: terminal.id }),
      ),
    );
    return items;
  }, [terminals]);

  const terminalItems = useMemo(
    () =>
      navigationItems.filter(
        (item): item is Extract<TerminalNavigationItem, { type: "terminal" }> =>
          item.type === "terminal",
      ),
    [navigationItems],
  );

  const registerNavigationItemRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      navigationItemRefs.current.set(id, element);
    } else {
      navigationItemRefs.current.delete(id);
    }
  }, []);

  const focusNavigationItem = useCallback((item: TerminalNavigationItem) => {
    const element = navigationItemRefs.current.get(terminalNavigationItemKey(item));
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }, []);

  const focusTerminalList = useCallback(() => {
    const activeItem = activeTerminalId
      ? navigationItems.find(
          (item): item is Extract<TerminalNavigationItem, { type: "terminal" }> =>
            item.type === "terminal" && item.id === activeTerminalId,
        )
      : undefined;
    focusNavigationItem(activeItem ?? navigationItems[0]!);
  }, [activeTerminalId, focusNavigationItem, navigationItems]);

  useFocusTarget("terminal-list-content", focusTerminalList);

  const selectTerminal = useCallback(
    (terminalId: string) => {
      updateProjectState(projectId, () => ({ activeTerminalId: terminalId }));
      onSelectTerminal(terminalId);
    },
    [onSelectTerminal, projectId, updateProjectState],
  );

  const createTerminal = useCallback(async () => {
    if (!projectId) return;
    const { terminalId } = await request.createTerminal({ projectId, cwd: "", clientId });
    updateProjectState(projectId, (prev) => ({
      terminals: [...prev.terminals, { id: terminalId, running: true, projectId }],
      activeTerminalId: terminalId,
    }));
    onSelectTerminal(terminalId);
  }, [onSelectTerminal, projectId, updateProjectState]);

  async function deleteTerminal(terminalId: string, e?: React.SyntheticEvent) {
    e?.stopPropagation();
    const shouldRestoreFocus = focusedNavigationItemIdRef.current === terminalId;
    const deletedIndex = navigationItems.findIndex(
      (item) => item.type === "terminal" && item.id === terminalId,
    );
    const focusTarget =
      deletedIndex === -1
        ? undefined
        : (navigationItems[deletedIndex + 1] ??
          navigationItems[deletedIndex - 1] ??
          navigationItems[0]);

    destroyTerminalInstance(terminalId);

    await request.killTerminal({ terminalId });

    updateProjectState(projectId, (prev) => {
      const nextList = prev.terminals.filter((terminal) => terminal.id !== terminalId);
      return {
        terminals: nextList,
        activeTerminalId:
          prev.activeTerminalId === terminalId
            ? (nextList[nextList.length - 1]?.id ?? null)
            : prev.activeTerminalId,
      };
    });

    if (shouldRestoreFocus && focusTarget) {
      window.requestAnimationFrame(() => focusNavigationItem(focusTarget));
    }
  }

  const handleNavigationKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, item: TerminalNavigationItem) => {
      const { key } = event;

      if (item.type === "add") {
        if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
          event.preventDefault();
          event.stopPropagation();
          focusNavigationItem(item);
          return;
        }

        if (key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          const firstTerminal = terminalItems[0];
          if (firstTerminal) focusNavigationItem(firstTerminal);
          return;
        }

        if (key === "Enter" || key === " " || key === "Spacebar") {
          event.preventDefault();
          event.stopPropagation();
          void createTerminal();
        }
        return;
      }

      const isVerticalNavigationKey =
        key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
      if (isVerticalNavigationKey) {
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = terminalItems.findIndex((terminal) => terminal.id === item.id);
        if (key === "ArrowUp" && currentIndex === 0) {
          focusNavigationItem({ type: "add" });
          return;
        }

        if (terminalItems.length === 0) return;
        const nextIndex =
          key === "Home"
            ? 0
            : key === "End"
              ? terminalItems.length - 1
              : Math.max(
                  0,
                  Math.min(
                    terminalItems.length - 1,
                    currentIndex + (key === "ArrowDown" ? 1 : -1),
                  ),
                );
        const nextTerminal = terminalItems[nextIndex];
        if (nextTerminal) focusNavigationItem(nextTerminal);
        return;
      }

      if (key === "/") {
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }),
        );
        return;
      }

      if (key === "Enter" || key === " " || key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        selectTerminal(item.id);
      }
    },
    [createTerminal, focusNavigationItem, selectTerminal, terminalItems],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-0.5 border-b border-border">
        <div className="flex text-muted-foreground items-center gap-1 px-3">
          <SquareTerminal className="size-3.5" />
          <span className="text-xs font-medium text-nowrap">{t("panel.terminal")}</span>
        </div>
        <div className="ml-auto mr-2 flex items-center">
          <Button
            ref={(element) => registerNavigationItemRef(ADD_TERMINAL_NAVIGATION_ID, element)}
            variant="ghost"
            size="icon"
            tabIndex={-1}
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => void createTerminal()}
            onKeyDown={(event) => handleNavigationKeyDown(event, { type: "add" })}
            onFocus={() => {
              focusedNavigationItemIdRef.current = ADD_TERMINAL_NAVIGATION_ID;
            }}
            aria-label={t("terminalPanel.addTerminal", "Add terminal")}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal list - vertical */}
      {terminals.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3 -mt-10">
            <SquareTerminal className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-xs text-muted-foreground/70">
            {t("terminalPanel.noTerminalSelected", "No terminals")}
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 py-1 px-1">
            {terminals.map((terminal) => (
              <ContextMenu key={terminal.id}>
                <ContextMenuTrigger
                  render={
                    <button
                      ref={(element) => registerNavigationItemRef(terminal.id, element)}
                      type="button"
                      tabIndex={-1}
                      className="outline-0 focus-visible:inset-ring-1 focus-visible:inset-ring-ring/80 rounded-md"
                      aria-current={terminal.id === activeTerminalId ? "true" : undefined}
                      onKeyDown={(event) =>
                        handleNavigationKeyDown(event, { type: "terminal", id: terminal.id })
                      }
                      onFocus={() => {
                        focusedNavigationItemIdRef.current = terminal.id;
                      }}
                    />
                  }
                  onClick={() => selectTerminal(terminal.id)}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md pl-2 pr-1.5 text-xs w-full transition-colors",
                    terminal.id === activeTerminalId
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Circle
                    className={cn(
                      "size-2 shrink-0",
                      terminal.running
                        ? "fill-emerald-400 text-emerald-400"
                        : "text-muted-foreground",
                    )}
                  />
                  <span className="flex-1 truncate text-left">{terminal.id.slice(0, 8)}</span>
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background/70"
                    onClick={(e) => void deleteTerminal(terminal.id, e)}
                  >
                    <X className="size-3 text-muted-foreground" />
                  </span>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => selectTerminal(terminal.id)}>
                    <Eye />
                    {t("terminalPanel.view", "View")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => void deleteTerminal(terminal.id)}
                  >
                    <Trash2 />
                    {t("terminalPanel.delete", "Delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
