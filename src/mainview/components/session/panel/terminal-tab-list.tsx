import { useTranslation } from "react-i18next";
import { Plus, SquareTerminal, X, Circle } from "lucide-react";
import { request, clientId } from "../../../backend";
import { useAppStore, useProjectState } from "../../../store";
import { destroyTerminalInstance } from "../../../lib/terminal-manager";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TerminalTabListProps {
  projectId: string;
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
}

export function TerminalTabList({
  projectId,
  activeTerminalId,
  onSelectTerminal,
}: TerminalTabListProps) {
  const { t } = useTranslation();
  const projectState = useProjectState(projectId);
  const terminals = projectState.terminals;
  const updateProjectState = useAppStore((s) => s.updateProjectState);

  async function createTerminal() {
    if (!projectId) return;
    const { terminalId } = await request.createTerminal({ projectId, cwd: "", clientId });
    updateProjectState(projectId, (prev) => ({
      terminals: [...prev.terminals, { id: terminalId, running: true, projectId }],
      activeTerminalId: terminalId,
    }));
    onSelectTerminal(terminalId);
  }

  async function deleteTerminal(terminalId: string, e: React.MouseEvent) {
    e.stopPropagation();
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
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-0.5 border-b border-border">
        <div className="flex text-muted-foreground items-center gap-1 px-3">
          <SquareTerminal className="size-4" />
          <span className="text-xs font-medium text-nowrap">{t("sessionView.terminal")}</span>
        </div>
        <div className="ml-auto mr-2 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => void createTerminal()}
            aria-label={t("terminalPanel.addTerminal", "Add terminal")}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal list - vertical */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 py-1 px-1">
          {terminals.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <span>{t("terminalPanel.noTerminalSelected", "No terminals")}</span>
            </div>
          ) : (
            terminals.map((terminal) => (
              <button
                key={terminal.id}
                type="button"
                onClick={() => {
                  updateProjectState(projectId, () => ({ activeTerminalId: terminal.id }));
                  onSelectTerminal(terminal.id);
                }}
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
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
