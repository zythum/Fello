import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useTranslation } from "react-i18next";
import { Plus, SquareTerminal, X, Circle } from "lucide-react";
import { request, subscribe } from "../backend";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalItem {
  id: string;
  running: boolean;
  projectId: string;
}

interface TerminalPanelProps {
  isActive: boolean;
  projectId: string;
}

export function TerminalPanel({ isActive, projectId }: TerminalPanelProps) {
  const { t } = useTranslation();
  const [projectTerminals, setProjectTerminals] = useState<Record<string, TerminalItem[]>>({});
  const [activeTerminalByProject, setActiveTerminalByProject] = useState<
    Record<string, string | null>
  >({});
  const projects = useAppStore((s) => s.projects);
  const projectTerminalsRef = useRef<Record<string, TerminalItem[]>>({});
  const previousProjectIdsRef = useRef(new Set<string>());
  const creatingProjectRef = useRef(new Set<string>());
  const containerRefs = useRef(new Map<string, HTMLDivElement | null>());
  const resizeObserverRefs = useRef(new Map<string, ResizeObserver>());
  const instanceRefs = useRef(
    new Map<
      string,
      {
        terminal: Terminal;
        fitAddon: FitAddon;
      }
    >(),
  );
  const pendingOutputRef = useRef(new Map<string, string>());

  const activeProjectId = projectId;

  const terminals = useMemo(
    () => (activeProjectId ? (projectTerminals[activeProjectId] ?? []) : []),
    [activeProjectId, projectTerminals],
  );
  const allTerminals = useMemo(() => Object.values(projectTerminals).flat(), [projectTerminals]);
  const activeTerminalId = useMemo(
    () => (activeProjectId ? (activeTerminalByProject[activeProjectId] ?? null) : null),
    [activeProjectId, activeTerminalByProject],
  );
  const cwd = useMemo(() => {
    if (!activeProjectId) return "";
    return projects.find((p) => p.id === activeProjectId)?.cwd ?? "";
  }, [activeProjectId, projects]);
  const fitTerminal = (terminalId: string) => {
    const instance = instanceRefs.current.get(terminalId);
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
    projectTerminalsRef.current = projectTerminals;
  }, [projectTerminals]);

  useEffect(() => {
    const onOutput = (payload: { terminalId: string; data: string }) => {
      const instance = instanceRefs.current.get(payload.terminalId);
      if (instance) {
        instance.terminal.write(payload.data);
        return;
      }
      const existing = pendingOutputRef.current.get(payload.terminalId) ?? "";
      pendingOutputRef.current.set(payload.terminalId, `${existing}${payload.data}`);
    };
    const onExit = (payload: { terminalId: string; exitCode: number | null }) => {
      const instance = instanceRefs.current.get(payload.terminalId);
      if (instance) {
        instance.terminal.options.disableStdin = true;
        instance.terminal.writeln(`\r\n[Process exited with code ${payload.exitCode ?? "null"}]`);
      }
      setProjectTerminals((prev) => {
        let changed = false;
        const next: Record<string, TerminalItem[]> = {};
        for (const [projectId, list] of Object.entries(prev)) {
          next[projectId] = list.map((terminal) => {
            if (terminal.id !== payload.terminalId) return terminal;
            changed = true;
            return { ...terminal, running: false };
          });
        }
        return changed ? next : prev;
      });
    };
    subscribe.on("terminal-output", onOutput);
    subscribe.on("terminal-exit", onExit);
    return () => {
      subscribe.off("terminal-output", onOutput);
      subscribe.off("terminal-exit", onExit);
    };
  }, []);

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
      if (instanceRefs.current.has(terminalItem.id)) continue;
      const container = containerRefs.current.get(terminalItem.id);
      if (!container) continue;
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 11,
        lineHeight: 1.35,
        theme: {
          background: terminalBackground,
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();
      terminal.onData((data) => {
        void request.writeTerminal({ terminalId: terminalItem.id, data });
      });
      instanceRefs.current.set(terminalItem.id, { terminal, fitAddon });
      const observer = new ResizeObserver(() => {
        fitTerminal(terminalItem.id);
      });
      observer.observe(container);
      resizeObserverRefs.current.set(terminalItem.id, observer);
      const pending = pendingOutputRef.current.get(terminalItem.id);
      if (pending) {
        terminal.write(pending);
        pendingOutputRef.current.delete(terminalItem.id);
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
    setActiveTerminalByProject((prev) => ({
      ...prev,
      [activeProjectId]: terminals[terminals.length - 1].id,
    }));
  }, [activeProjectId, activeTerminalId, terminals]);

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
      const all = projectTerminalsRef.current;
      for (const projectId of removedProjectIds) {
        const list = all[projectId] ?? [];
        for (const terminal of list) {
          void request.killTerminal({ terminalId: terminal.id });
          const instance = instanceRefs.current.get(terminal.id);
          if (instance) {
            instance.terminal.dispose();
            instanceRefs.current.delete(terminal.id);
          }
          const observer = resizeObserverRefs.current.get(terminal.id);
          if (observer) {
            observer.disconnect();
            resizeObserverRefs.current.delete(terminal.id);
          }
          containerRefs.current.delete(terminal.id);
          pendingOutputRef.current.delete(terminal.id);
        }
      }
      setProjectTerminals((prev) => {
        const next = { ...prev };
        for (const projectId of removedProjectIds) {
          delete next[projectId];
        }
        return next;
      });
      setActiveTerminalByProject((prev) => {
        const next = { ...prev };
        for (const projectId of removedProjectIds) {
          delete next[projectId];
        }
        return next;
      });
    }
    previousProjectIdsRef.current = currentProjectIds;
  }, [projects]);

  useEffect(() => {
    return () => {
      for (const list of Object.values(projectTerminalsRef.current)) {
        for (const terminal of list) {
          void request.killTerminal({ terminalId: terminal.id });
        }
      }
      for (const { terminal } of instanceRefs.current.values()) {
        terminal.dispose();
      }
      for (const observer of resizeObserverRefs.current.values()) {
        observer.disconnect();
      }
      instanceRefs.current.clear();
      resizeObserverRefs.current.clear();
      containerRefs.current.clear();
      pendingOutputRef.current.clear();
    };
  }, []);

  async function createTerminal(projectIdArg?: string, cwdArg?: string) {
    const projectId = projectIdArg ?? activeProjectId;
    const targetCwd = cwdArg ?? "";
    if (!projectId) return;
    const { terminalId } = await request.createTerminal({ projectId, cwd: targetCwd });
    setProjectTerminals((prev) => ({
      ...prev,
      [projectId]: [...(prev[projectId] ?? []), { id: terminalId, running: true, projectId }],
    }));
    setActiveTerminalByProject((prev) => ({ ...prev, [projectId]: terminalId }));
  }

  async function deleteTerminal(terminalId: string, projectId: string) {
    const instance = instanceRefs.current.get(terminalId);
    if (instance) {
      instance.terminal.dispose();
      instanceRefs.current.delete(terminalId);
    }
    const observer = resizeObserverRefs.current.get(terminalId);
    if (observer) {
      observer.disconnect();
      resizeObserverRefs.current.delete(terminalId);
    }
    containerRefs.current.delete(terminalId);
    pendingOutputRef.current.delete(terminalId);
    await request.killTerminal({ terminalId });
    setProjectTerminals((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] ?? []).filter((terminal) => terminal.id !== terminalId),
    }));
    const nextList = (projectTerminalsRef.current[projectId] ?? []).filter(
      (terminal) => terminal.id !== terminalId,
    );
    setActiveTerminalByProject((prev) => ({
      ...prev,
      [projectId]:
        prev[projectId] === terminalId
          ? (nextList[nextList.length - 1]?.id ?? null)
          : prev[projectId],
    }));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
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
                  setActiveTerminalByProject((prev) => ({
                    ...prev,
                    [activeProjectId]: terminal.id,
                  }))
                }
                className="flex h-6 items-center gap-1 px-2"
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
                <X className="size-3" />
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
                "absolute inset-0",
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
