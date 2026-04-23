import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, SquareTerminal, X, Circle } from "lucide-react";
import { request, clientId } from "../../../backend";
import { useAppStore, useProjectState } from "../../../store";
import {
  getOrCreateTerminalInstance,
  destroyTerminalInstance,
} from "../../../lib/terminal-manager";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalPanelProps {
  isActive: boolean;
  projectId: string;
}

export function TerminalPanel({ isActive, projectId }: TerminalPanelProps) {
  const { t } = useTranslation();

  const projectState = useProjectState(projectId);
  const terminals = projectState.terminals;
  const activeTerminalId = projectState.activeTerminalId;
  const updateProjectState = useAppStore((s) => s.updateProjectState);

  const projects = useAppStore((s) => s.projects);
  const projectStates = useAppStore((s) => s.projectStates);

  const previousProjectIdsRef = useRef(new Set<string>());
  const creatingProjectRef = useRef(new Set<string>());
  const containerRefs = useRef(new Map<string, HTMLDivElement | null>());
  const resizeObserverRefs = useRef(new Map<string, ResizeObserver>());

  const activeProjectId = projectId;
  const allTerminals = useMemo(
    () => Array.from(projectStates.values()).flatMap((s) => s.terminals),
    [projectStates],
  );

  const cwd = useMemo(() => {
    if (!activeProjectId) return "";
    return projects.find((p) => p.id === activeProjectId)?.cwd ?? "";
  }, [activeProjectId, projects]);

  const fitTerminal = (terminalId: string) => {
    const instance = getOrCreateTerminalInstance(terminalId, activeProjectId, "");
    const container = containerRefs.current.get(terminalId);
    if (!instance || !container) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    instance.fitAddon.fit();
    void request.resizeTerminal({
      terminalId,
      cols: instance.terminal.cols,
      rows: instance.terminal.rows,
    });
  };

  useEffect(() => {
    if (!isActive) return;
    if (!activeProjectId) return;
    if (!cwd) return;
    if (terminals.length > 0) return;
    if (creatingProjectRef.current.has(activeProjectId)) return;
    creatingProjectRef.current.add(activeProjectId);
    void createTerminal(activeProjectId, "").finally(() => {
      creatingProjectRef.current.delete(activeProjectId);
    });
  }, [isActive, activeProjectId, cwd, terminals.length]);

  useEffect(() => {
    const terminalBackground =
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--color-neutral-900")
        .trim() || "#0f0f10";

    for (const terminalItem of allTerminals) {
      const container = containerRefs.current.get(terminalItem.id);
      if (!container) continue;

      const instance = getOrCreateTerminalInstance(
        terminalItem.id,
        terminalItem.projectId,
        terminalBackground,
      );

      if (instance.terminal.element?.parentElement !== container) {
        if (!instance.terminal.element) {
          instance.terminal.open(container);
        } else {
          container.appendChild(instance.terminal.element);
        }
      }

      if (!resizeObserverRefs.current.has(terminalItem.id)) {
        const observer = new ResizeObserver(() => {
          fitTerminal(terminalItem.id);
        });
        observer.observe(container);
        resizeObserverRefs.current.set(terminalItem.id, observer);
      }

      requestAnimationFrame(() => {
        fitTerminal(terminalItem.id);
      });
    }
  }, [allTerminals]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (terminals.length === 0) return;
    if (activeTerminalId && terminals.some((terminal) => terminal.id === activeTerminalId)) return;
    updateProjectState(activeProjectId, () => ({
      activeTerminalId: terminals[terminals.length - 1].id,
    }));
  }, [activeProjectId, activeTerminalId, terminals, updateProjectState]);

  useEffect(() => {
    if (!activeTerminalId) return;
    requestAnimationFrame(() => {
      fitTerminal(activeTerminalId);
    });
  }, [activeTerminalId]);

  useEffect(() => {
    const onResize = () => {
      if (!activeTerminalId) return;
      fitTerminal(activeTerminalId);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeTerminalId]);

  useEffect(() => {
    const currentProjectIds = new Set(projects.map((project) => project.id));
    const removedProjectIds = [...previousProjectIdsRef.current].filter(
      (projectId) => !currentProjectIds.has(projectId),
    );
    if (removedProjectIds.length > 0) {
      for (const projectId of removedProjectIds) {
        const list = projectStates.get(projectId)?.terminals ?? [];
        for (const terminal of list) {
          void request.killTerminal({ terminalId: terminal.id });
          destroyTerminalInstance(terminal.id);
          const observer = resizeObserverRefs.current.get(terminal.id);
          if (observer) {
            observer.disconnect();
            resizeObserverRefs.current.delete(terminal.id);
          }
          containerRefs.current.delete(terminal.id);
        }
        useAppStore.setState((state) => {
          const map = new Map(state.projectStates);
          map.delete(projectId);
          return { projectStates: map };
        });
      }
    }
    previousProjectIdsRef.current = currentProjectIds;
  }, [projects, projectStates]);

  useEffect(() => {
    return () => {
      for (const observer of resizeObserverRefs.current.values()) {
        observer.disconnect();
      }
      resizeObserverRefs.current.clear();
      containerRefs.current.clear();
    };
  }, []);

  async function createTerminal(projectIdArg?: string, cwdArg?: string) {
    const projectId = projectIdArg ?? activeProjectId;
    const targetCwd = cwdArg ?? "";
    if (!projectId) return;
    const { terminalId } = await request.createTerminal({ projectId, cwd: targetCwd, clientId });
    updateProjectState(projectId, (prev) => ({
      terminals: [...prev.terminals, { id: terminalId, running: true, projectId }],
      activeTerminalId: terminalId,
    }));
  }

  async function deleteTerminal(terminalId: string, projectId: string) {
    destroyTerminalInstance(terminalId);

    const observer = resizeObserverRefs.current.get(terminalId);
    if (observer) {
      observer.disconnect();
      resizeObserverRefs.current.delete(terminalId);
    }
    containerRefs.current.delete(terminalId);

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
      <div className="h-10 flex shrink-0 items-center gap-0.5 border-b border-border mr-10">
        <div className="flex text-muted-foreground items-center gap-1 px-3">
          <SquareTerminal className="size-4" />
          <span className="text-xs font-medium text-nowrap">{t("sessionView.terminal")}</span>
        </div>
        <div className="flex h-full min-w-0 items-center gap-0.5 overflow-x-auto">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                "flex h-6 items-center gap-1 rounded-md pr-1 text-xs",
                terminal.id === activeTerminalId
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() =>
                  activeProjectId &&
                  updateProjectState(activeProjectId, () => ({
                    activeTerminalId: terminal.id,
                  }))
                }
                className="flex h-6 items-center gap-1 pl-2"
              >
                <Circle
                  className={cn(
                    "size-2",
                    terminal.running
                      ? "fill-emerald-400 text-emerald-400"
                      : "text-muted-foreground",
                  )}
                />
                <span className="max-w-28 truncate">{terminal.id.slice(0, 4)}</span>
              </button>
              <button
                type="button"
                onClick={() => void deleteTerminal(terminal.id, terminal.projectId)}
                className="rounded p-0.5 hover:bg-background/70"
              >
                <X className="size-2.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
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

      <div className="relative min-h-0 flex-1 bg-neutral-900">
        {allTerminals.length > 0 ? (
          allTerminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                "absolute inset-0 overflow-hidden",
                terminal.id === activeTerminalId ? "block" : "pointer-events-none hidden",
              )}
            >
              <div
                ref={(element) => {
                  containerRefs.current.set(terminal.id, element);
                }}
                className="h-full w-full px-2 py-1"
              />
            </div>
          ))
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="flex items-center gap-2 text-sm">
              <SquareTerminal className="size-4" />
              <span>{t("terminalPanel.noTerminalSelected", "No terminal selected")}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
