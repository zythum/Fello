import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../lib/session-state-reducer";
import { useAppStore } from "../../store";
import { Chat } from "./chat/chat";
import { FilePanel } from "./file-panel/file-panel";
import { TerminalPanel } from "./terminal-panel/terminal-panel";
import { Loader2, Folders, SquareTerminal, MoreHorizontal, RefreshCw, ChevronDown } from "lucide-react";
import { formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { request } from "../../backend";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Panel } from "./panel";
import { useMessage } from "../providers/message";
import type { SessionInfo } from "../../../shared/schema";

export function SessionView({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const isCreatingSession = useAppStore((s) => s.isCreatingSession);
  const isLoading = useAppStore((s) =>
    sessionId ? (s.sessionStates.get(sessionId)?.isLoading ?? false) : false,
  );
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = session.projectId;
  const currentProjectInfo = projects.find((project) => project.id === currentProjectId);
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
  const { toast } = useMessage();

  const [filesOpen, setFilesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto load session if not loaded
  useEffect(() => {
    if (!sessionId) return;
    const sessionState = useAppStore.getState().getSessionState(sessionId);
    // Don't auto load if we are currently creating a session or if it's already loaded
    if (sessionState.messages.length > 0 || isCreatingSession) {
      return;
    }

    let isCurrent = true;

    const fetchHistory = async () => {
      useAppStore.getState().updateSessionState(sessionId, (prev) => ({
        ...reduceFlushStreaming(prev),
        isLoading: true,
      }));

      try {
        const result = await request.getSessionHistory({ sessionId });

        if (!isCurrent) {
          useAppStore
            .getState()
            .updateSessionState(sessionId, (prev) => ({ ...prev, isLoading: false }));
          return;
        }

        let state = useAppStore.getState().getSessionState(sessionId);
        state = { ...state, messages: [], activeToolCalls: new Map() };

        // Load static history
        for (const notification of result.messages) {
          if (!notification?.update) continue;
          state = reduceSessionUpdate(state, notification.update);
        }

        // Deduplicate and apply pending updates that arrived while fetching history
        const displayIds = new Set(
          result.messages.map((m) => m?.update?._meta?.fello?.displayId).filter(Boolean),
        );
        for (const update of state.pendingUpdates) {
          const did = update._meta?.fello?.displayId;
          if (did && displayIds.has(did)) {
            continue; // Skip duplicate
          }
          state = reduceSessionUpdate(state, update);
        }

        state.isStreaming = result.isStreaming;
        state.isLoading = false;
        state.pendingUpdates = [];

        useAppStore.getState().updateSessionState(sessionId, () => state);

        // Silently warm up the bridge (get models/modes)
        request.loadSession({ sessionId }).catch(console.error);
      } catch (err) {
        console.error("Failed to fetch session history", err);
        if (isCurrent) {
          useAppStore
            .getState()
            .updateSessionState(sessionId, (prev) => ({ ...prev, isLoading: false }));
        }
      }
    };

    void fetchHistory();

    return () => {
      isCurrent = false;
      useAppStore
        .getState()
        .updateSessionState(sessionId, (prev) => ({ ...prev, isLoading: false }));
    };
  }, [sessionId, isCreatingSession]);

  const handleToggleFiles = useCallback(() => {
    if (!filesOpen) {
      setTerminalOpen(false);
      setFilesOpen(true);
    } else {
      setFilesOpen(false);
    }
  }, [filesOpen]);

  const handleToggleTerminal = useCallback(() => {
    if (!terminalOpen) {
      setFilesOpen(false);
      setTerminalOpen(true);
    } else {
      setTerminalOpen(false);
    }
  }, [terminalOpen]);

  const openPreviewFile = useCallback(
    (file: { projectId: string; relativePath: string }) => {
      if (currentProjectId !== file.projectId) {
        return;
      }
      if (previewCloseTimeoutRef.current) {
        clearTimeout(previewCloseTimeoutRef.current);
        previewCloseTimeoutRef.current = null;
      }
      setPreviewFile(file.relativePath);
      setTerminalOpen(false);
      setFilesOpen(true);
    },
    [currentProjectId],
  );

  useEffect(() => {
    setPreviewFile(null);
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    const handlePreviewFile = (e: Event) => {
      const event = e as CustomEvent<{ projectId?: string | null; relativePath?: string | null }>;
      const relativePath = event.detail?.relativePath ?? null;
      const projectId = event.detail?.projectId ?? currentProjectId ?? null;
      if (!relativePath || !projectId) return;
      openPreviewFile({ projectId, relativePath });
    };
    document.addEventListener("fello-preview-file", handlePreviewFile);
    return () => document.removeEventListener("fello-preview-file", handlePreviewFile);
  }, [currentProjectId, openPreviewFile]);

  const handleRefreshSession = async () => {
    if (!session) return;
    const { resetSessionState, updateSessionState } = useAppStore.getState();

    try {
      updateSessionState(session.id, (prev) => reduceFlushStreaming(prev));
      resetSessionState(session.id);
      updateSessionState(session.id, () => ({ isLoading: true }));
      const result = await request.getSessionHistory({ sessionId: session.id });
      if (!result) return;

      let state = useAppStore.getState().getSessionState(session.id);
      state = { ...state, messages: [], activeToolCalls: new Map() };
      for (const notification of result.messages) {
        if (!notification?.update) continue;
        state = reduceSessionUpdate(state, notification.update);
      }

      const displayIds = new Set(
        result.messages.map((m) => m?.update?._meta?.fello?.displayId).filter(Boolean),
      );
      for (const update of state.pendingUpdates) {
        const did = update._meta?.fello?.displayId;
        if (did && displayIds.has(did)) continue;
        state = reduceSessionUpdate(state, update);
      }

      state.isStreaming = result.isStreaming;
      state.pendingUpdates = [];
      state.isLoading = false;

      updateSessionState(session.id, () => state);

      // Warm up bridge silently
      request.loadSession({ sessionId: session.id }).catch(console.error);
    } catch (err) {
      console.error("Failed to load session:", err);
      const message =
        extractErrorMessage(err) || t("chat.failedToLoadSession", "Failed to load session.");
      toast.error(message);
    } finally {
      updateSessionState(session.id, () => ({ isLoading: false }));
    }
  };

  const handleToggleMcpServer = async (mcpId: string) => {
    if (!session) return;
    const currentMcpServers = session.mcpServers || [];
    const newMcpServers = currentMcpServers.includes(mcpId)
      ? currentMcpServers.filter((id) => id !== mcpId)
      : [...currentMcpServers, mcpId];
    try {
      await request.updateSessionMcpServers({
        sessionId: session.id,
        mcpServers: newMcpServers,
      });
    } catch (err) {
      console.error("Failed to update MCP servers:", err);
      toast.error(
        extractErrorMessage(err) ||
          t("chat.failedToUpdateMcpServers", "Failed to update MCP servers"),
      );
    }
  };

  return (
    <main ref={containerRef} className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
      {!sessionId && (isLoading || isCreatingSession) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 relative">
          <div className="absolute left-0 top-0 right-0 h-12" style={{ WebkitAppRegion: "drag" }} />
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-normal text-muted-foreground/60">
            {t("sessionView.connecting")}
          </p>
        </div>
      ) : sessionId ? (
        <div className="relative flex h-full flex-col flex-1 min-h-0">
          <div
            className="relative z-30 flex h-12 items-center border-b border-border gap-2 pl-2.5 pr-2.5 bg-background"
            style={{ WebkitAppRegion: "drag" }}
          >
            <Badge variant="outline" className="px-1 text-[10px] uppercase select-none">
              {session.agentId}
            </Badge>
            <div className="flex flex-1 min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
                {session.title || t("sidebar.newChat", "New Chat")}
              </span>
              <span className="flex-1 text-[10px] text-muted-foreground truncate">
                {currentProjectInfo?.cwd}
              </span>
              <span className="shrink-0 text-xs text-sidebar-foreground/70 whitespace-nowrap">
                {formatUpdatedTime(session.updatedAt)}
              </span>
            </div>
            <div
              className="ml-1 flex items-center shrink-0 gap-1"
              style={{ WebkitAppRegion: "no-drag" }}
            >
              <button
                type="button"
                onClick={handleToggleFiles}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md outline-none transition-colors",
                  filesOpen
                    ? "bg-sidebar-accent/50 text-sidebar-foreground"
                    : "text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70",
                )}
              >
                <Folders className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleToggleTerminal}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md outline-none transition-colors",
                  terminalOpen
                    ? "bg-sidebar-accent/50 text-sidebar-foreground"
                    : "text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70",
                )}
              >
                <SquareTerminal className="size-4" />
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors">
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {configuredMcpServers.length > 0 && (
                    <>
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-[10px] font-semibold text-muted-foreground">
                          {t("settings.mcp.title", "MCP Servers")}
                        </DropdownMenuLabel>
                        {configuredMcpServers.map((mcp) => (
                          <DropdownMenuCheckboxItem
                            key={mcp.id}
                            className="text-xs"
                            checked={(session.mcpServers || []).includes(mcp.id)}
                            onCheckedChange={() => handleToggleMcpServer(mcp.id)}
                            onSelect={(e) => e.preventDefault()}
                          >
                            {mcp.id}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleRefreshSession}>
                    <RefreshCw className="size-3" />
                    {t("chatHeader.refresh", "Refresh")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Chat session={session} />
          {(isLoading || isCreatingSession) && (
            <div className="absolute inset-0 top-12 z-50 flex flex-col items-center justify-center gap-4 bg-background/90">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-normal text-foreground/50">
                {t("sessionView.connecting")}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <Panel open={filesOpen}>
        <div className="h-full relative overflow-hidden">
          <div className="h-full overflow-hidden bg-background">
            {currentProjectId && <FilePanel projectId={currentProjectId} file={previewFile} />}
          </div>
          <div className="absolute right-2.5 top-1.5 z-10">
            <button
              type="button"
              onClick={() => setFilesOpen(false)}
              className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
        </div>
      </Panel>

      <Panel open={terminalOpen}>
        <div className="h-full relative overflow-hidden">
          <div className="h-full overflow-hidden bg-background">
            {currentProjectId && (
              <TerminalPanel isActive={terminalOpen} projectId={currentProjectId} />
            )}
          </div>
          <div className="absolute right-2.5 top-1.5 z-10">
            <button
              type="button"
              onClick={() => setTerminalOpen(false)}
              className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
        </div>
      </Panel>
    </main>
  );
}
