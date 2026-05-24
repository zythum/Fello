import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../lib/session-state-reducer";
import { useAppStore } from "../../store";
import { Chat } from "./chat/chat";
import { Detail, type DetailType } from "./detail/detail";
import { Panel, type PanelTab } from "./panel/panel";
import { Loader2 } from "lucide-react";
import { request } from "../../backend";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { SessionInfo } from "../../../shared/schema";

export { type PanelTab } from "./panel/panel";

export function Session({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const isCreatingSession = useAppStore((s) => s.isCreatingSession);
  const isLoading = useAppStore((s) =>
    sessionId ? (s.sessionStates.get(sessionId)?.isLoading ?? false) : false,
  );
  const currentProjectId = session.projectId;

  // Panel state — defaults to "files" so Panel always shows content
  const [panelTab, setPanelTab] = useState<PanelTab>("files");
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState<boolean>(false);

  useEffect(() => {
    if (!mainEl) {
      return;
    }
    const callback = () => setCompact(mainEl.offsetWidth < 1000);
    const observer = new ResizeObserver(callback);
    observer.observe(mainEl);
    callback();
    return () => observer.disconnect();
  }, [mainEl]);

  // Detail state
  const [detailType, setDetailType] = useState<DetailType | null>(null);
  const [detailFile, setDetailFile] = useState<string | null>(null);
  const [detailTerminalId, setDetailTerminalId] = useState<string | null>(null);

  const detailOpen = detailType !== null;

  // Handle preview file from file tree
  const handlePreviewFile = useCallback((file: string) => {
    setDetailType("file");
    setDetailFile(file);
    setDetailTerminalId(null);
  }, []);

  // Handle select terminal from terminal tab list
  const handleSelectTerminal = useCallback((terminalId: string) => {
    setDetailType("terminal");
    setDetailTerminalId(terminalId);
    setDetailFile(null);
  }, []);

  // Handle detail close
  const handleDetailClose = useCallback(() => {
    setDetailType(null);
    setDetailFile(null);
    setDetailTerminalId(null);
  }, []);

  // Clear detail on session change
  useEffect(() => {
    setDetailType(null);
    setDetailFile(null);
    setDetailTerminalId(null);
  }, [sessionId]);

  // Listen for fello-preview-file events (from tool-bubble, etc.)
  useEffect(() => {
    const handlePreviewFileEvent = (e: Event) => {
      const event = e as CustomEvent<{ projectId?: string | null; relativePath?: string | null }>;
      const relativePath = event.detail?.relativePath ?? null;
      const projectId = event.detail?.projectId ?? currentProjectId ?? null;
      if (!relativePath || !projectId) return;
      if (projectId !== currentProjectId) return;
      handlePreviewFile(relativePath);
    };
    document.addEventListener("fello-preview-file", handlePreviewFileEvent);
    return () => document.removeEventListener("fello-preview-file", handlePreviewFileEvent);
  }, [currentProjectId, handlePreviewFile]);

  // Auto load session if not loaded
  useEffect(() => {
    if (!sessionId) return;
    const sessionState = useAppStore.getState().getSessionState(sessionId);
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

        for (const notification of result.messages) {
          if (!notification?.update) continue;
          state = reduceSessionUpdate(state, notification.update);
        }

        const displayIds = new Set(
          result.messages.map((m) => m?.update?._meta?.fello?.displayId).filter(Boolean),
        );
        for (const update of state.pendingUpdates) {
          const did = update._meta?.fello?.displayId;
          if (did && displayIds.has(did)) {
            continue;
          }
          state = reduceSessionUpdate(state, update);
        }

        state.isLoading = false;
        state.pendingUpdates = [];

        useAppStore.getState().updateSessionState(sessionId, () => state);

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

  return (
    <main ref={setMainEl} className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
      {!sessionId && (isLoading || isCreatingSession) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 relative">
          <div className="absolute left-0 top-0 right-0 h-12" style={{ WebkitAppRegion: "drag" }} />
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-normal text-muted-foreground/60">{t("session.connecting")}</p>
        </div>
      ) : sessionId ? (
        <div className="relative flex h-full flex-col flex-1 min-h-0">
          {/* Outer: always 2 panels → Panel width stable */}
          <ResizablePanelGroup className="flex h-full min-h-0">
            {/* Left: chat + optional detail (inner resizable group) */}
            <ResizablePanel id="left" minSize={600}>
              <ResizablePanelGroup className="flex h-full min-h-0">
                {/* Chat — collapses when window too small with detail open */}
                <ResizablePanel
                  id="chat"
                  minSize={400}
                  disabled={compact && detailOpen}
                  collapsedSize={0}
                  maxSize={compact && detailOpen ? 0 : undefined}
                >
                  <Chat session={session} />
                </ResizablePanel>

                {/* Detail (conditional — only affects inner group) */}
                {detailOpen && (
                  <>
                    {!compact && <ResizableHandle className="bg-border/70" />}
                    <ResizablePanel id="detail" defaultSize={400} minSize={300}>
                      <Detail
                        detailType={detailType}
                        projectId={currentProjectId}
                        file={detailFile}
                        terminalId={detailTerminalId}
                        onClose={handleDetailClose}
                      />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle className="bg-border/70" />

            {/* Right Panel — fixed pixel width, never recalculates */}
            <ResizablePanel
              id="panel"
              groupResizeBehavior="preserve-pixel-size"
              defaultSize={250}
              minSize={250}
              maxSize={400}
            >
              <Panel
                tab={panelTab}
                onTabChange={(tab) => setPanelTab(tab)}
                projectId={currentProjectId}
                previewFileId={detailType === "file" ? detailFile : null}
                activeTerminalId={detailType === "terminal" ? detailTerminalId : null}
                onPreviewFile={handlePreviewFile}
                onSelectTerminal={handleSelectTerminal}
              />
            </ResizablePanel>
          </ResizablePanelGroup>

          {(isLoading || isCreatingSession) && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-normal text-foreground/50">{t("session.connecting")}</p>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
