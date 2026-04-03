import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, SquareTerminal, X, Circle } from "lucide-react";
import { request, subscribe } from "../backend";
import { useAppStore } from "../store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalItem {
  id: string;
  running: boolean;
  sessionId: string;
}

interface TerminalPanelProps {
  isActive: boolean;
}

export function TerminalPanel({ isActive }: TerminalPanelProps) {
  const [sessionTerminals, setSessionTerminals] = useState<Record<string, TerminalItem[]>>({});
  const [activeTerminalBySession, setActiveTerminalBySession] = useState<
    Record<string, string | null>
  >({});
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionTerminalsRef = useRef<Record<string, TerminalItem[]>>({});
  const previousSessionIdsRef = useRef(new Set<string>());
  const creatingSessionRef = useRef(new Set<string>());
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

  const terminals = useMemo(
    () => (activeSessionId ? (sessionTerminals[activeSessionId] ?? []) : []),
    [activeSessionId, sessionTerminals],
  );
  const allTerminals = useMemo(() => Object.values(sessionTerminals).flat(), [sessionTerminals]);
  const activeTerminalId = useMemo(
    () => (activeSessionId ? (activeTerminalBySession[activeSessionId] ?? null) : null),
    [activeSessionId, activeTerminalBySession],
  );
  const cwd = useMemo(() => {
    if (!activeSessionId) return "";
    return sessions.find((session) => session.id === activeSessionId)?.cwd ?? "";
  }, [activeSessionId, sessions]);
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
    sessionTerminalsRef.current = sessionTerminals;
  }, [sessionTerminals]);

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
      setSessionTerminals((prev) => {
        let changed = false;
        const next: Record<string, TerminalItem[]> = {};
        for (const [sessionId, list] of Object.entries(prev)) {
          next[sessionId] = list.map((terminal) => {
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
    if (!activeSessionId) return;
    if (!cwd) return;
    if (terminals.length > 0) return;
    if (creatingSessionRef.current.has(activeSessionId)) return;
    creatingSessionRef.current.add(activeSessionId);
    void createTerminal(activeSessionId, cwd).finally(() => {
      creatingSessionRef.current.delete(activeSessionId);
    });
  }, [isActive, activeSessionId, cwd, terminals.length]);

  useEffect(() => {
    for (const terminalItem of allTerminals) {
      if (instanceRefs.current.has(terminalItem.id)) continue;
      const container = containerRefs.current.get(terminalItem.id);
      if (!container) continue;
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        lineHeight: 1.35,
        theme: {
          background: "#0f0f10",
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
    if (!activeSessionId) return;
    if (terminals.length === 0) return;
    if (activeTerminalId && terminals.some((terminal) => terminal.id === activeTerminalId)) return;
    setActiveTerminalBySession((prev) => ({
      ...prev,
      [activeSessionId]: terminals[terminals.length - 1].id,
    }));
  }, [activeSessionId, activeTerminalId, terminals]);

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
    const currentSessionIds = new Set(sessions.map((session) => session.id));
    const removedSessionIds = [...previousSessionIdsRef.current].filter(
      (sessionId) => !currentSessionIds.has(sessionId),
    );
    if (removedSessionIds.length > 0) {
      const all = sessionTerminalsRef.current;
      for (const sessionId of removedSessionIds) {
        const list = all[sessionId] ?? [];
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
      setSessionTerminals((prev) => {
        const next = { ...prev };
        for (const sessionId of removedSessionIds) {
          delete next[sessionId];
        }
        return next;
      });
      setActiveTerminalBySession((prev) => {
        const next = { ...prev };
        for (const sessionId of removedSessionIds) {
          delete next[sessionId];
        }
        return next;
      });
    }
    previousSessionIdsRef.current = currentSessionIds;
  }, [sessions]);

  useEffect(() => {
    return () => {
      for (const list of Object.values(sessionTerminalsRef.current)) {
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

  async function createTerminal(sessionIdArg?: string, cwdArg?: string) {
    const sessionId = sessionIdArg ?? activeSessionId;
    const targetCwd = cwdArg ?? cwd;
    if (!sessionId) return;
    if (!targetCwd) return;
    const { terminalId } = await request.createTerminal({ sessionId, cwd: targetCwd });
    setSessionTerminals((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), { id: terminalId, running: true, sessionId }],
    }));
    setActiveTerminalBySession((prev) => ({ ...prev, [sessionId]: terminalId }));
  }

  async function deleteTerminal(terminalId: string, sessionId: string) {
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
    setSessionTerminals((prev) => ({
      ...prev,
      [sessionId]: (prev[sessionId] ?? []).filter((terminal) => terminal.id !== terminalId),
    }));
    const nextList = (sessionTerminalsRef.current[sessionId] ?? []).filter(
      (terminal) => terminal.id !== terminalId,
    );
    setActiveTerminalBySession((prev) => ({
      ...prev,
      [sessionId]:
        prev[sessionId] === terminalId
          ? (nextList[nextList.length - 1]?.id ?? null)
          : prev[sessionId],
    }));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md pr-1 text-xs",
                terminal.id === activeTerminalId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() =>
                  activeSessionId &&
                  setActiveTerminalBySession((prev) => ({
                    ...prev,
                    [activeSessionId]: terminal.id,
                  }))
                }
                className="flex h-7 items-center gap-1 px-2"
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
                onClick={() => void deleteTerminal(terminal.id, terminal.sessionId)}
                className="rounded p-0.5 hover:bg-background/70"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void createTerminal()}
          aria-label="Add terminal"
        >
          <Plus className="size-3" />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
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
              <span>No terminal selected</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
