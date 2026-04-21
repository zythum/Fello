import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { reduceFlushStreaming } from "../../lib/session-state-reducer";
import { useAppStore } from "../../store";
import { Chat } from "../chat/chat";
import { FilePanel } from "./file-panel";
import { TerminalPanel } from "./terminal-panel";
import { FilePreviewSheet } from "./file-preview";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Loader2, FolderTree, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { request } from "../../backend";
import type { SessionInfo } from "../../../shared/schema";

export function SessionView({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const isCreatingSession = useAppStore((s) => s.isCreatingSession);
  const isLoading = useAppStore((s) =>
    sessionId ? (s.sessionStates.get(sessionId)?.isLoading ?? false) : false,
  );
  const activeProjectId = session.projectId;
  const [rightTab, setRightTab] = useState<"files" | "terminal">("files");

  const [rightPanel, setRightPanel] = useState<HTMLElement | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(0);
  const [previewFile, setPreviewFile] = useState<{
    projectId: string;
    relativePath: string;
  } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto load session if not loaded
  useEffect(() => {
    if (!sessionId) return;
    const sessionState = useAppStore.getState().getSessionState(sessionId);
    // Don't auto load if we are currently creating a session or if it's already loaded
    if (sessionState.messages.length > 0 || isCreatingSession || sessionState.isLoading) {
      return;
    }

    // Also use a flag to track if a load request is already inflight for this session
    const loadSession = async () => {
      useAppStore.getState().updateSessionState(sessionId, (prev) => ({
        ...reduceFlushStreaming(prev),
        isLoading: true,
      }));
      try {
        const result = await request.loadSession({ sessionId });
        useAppStore.getState().updateSessionState(sessionId, (prev) => ({
          ...prev,
          isStreaming: result.isStreaming,
        }));
      } catch (err) {
        console.error("Failed to auto load session", err);
      } finally {
        useAppStore
          .getState()
          .updateSessionState(sessionId, (prev) => ({ ...prev, isLoading: false }));
      }
    };

    void loadSession();
  }, [sessionId, isCreatingSession]);

  const openPreviewFile = useCallback((file: { projectId: string; relativePath: string }) => {
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }
    setPreviewFile(file);
    setIsPreviewOpen(true);
  }, []);

  const closePreview = () => {
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }
    setIsPreviewOpen(false);
    previewCloseTimeoutRef.current = setTimeout(() => {
      setPreviewFile(null);
      previewCloseTimeoutRef.current = null;
    }, 300);
  };

  useEffect(() => {
    setPreviewFile(null);
    setIsPreviewOpen(false);
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    const handlePreviewFile = (e: Event) => {
      const event = e as CustomEvent<{ projectId?: string | null; relativePath?: string | null }>;
      const relativePath = event.detail?.relativePath ?? null;
      const projectId = event.detail?.projectId ?? activeProjectId ?? null;
      if (!relativePath || !projectId) return;
      openPreviewFile({ projectId, relativePath });
    };
    document.addEventListener("fello-preview-file", handlePreviewFile);
    return () => document.removeEventListener("fello-preview-file", handlePreviewFile);
  }, [activeProjectId, openPreviewFile]);

  useEffect(() => {
    if (!rightPanel) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setRightPanelWidth(entry.contentRect.width);
      }
    });
    observer.observe(rightPanel);
    return () => observer.disconnect();
  }, [rightPanel]);

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        {!sessionId && (isLoading || isCreatingSession) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 relative">
            <div
              className="absolute left-0 top-0 right-0 h-12"
              style={{ WebkitAppRegion: "drag" }}
            />
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-normal text-muted-foreground/60">
              {t("sessionView.connecting")}
            </p>
          </div>
        ) : sessionId ? (
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize={700} minSize={300}>
              <div className="relative flex h-full flex-col">
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
            </ResizablePanel>
            <ResizableHandle className="bg-sidebar-border" />
            <ResizablePanel defaultSize={300} minSize={300}>
              <aside ref={setRightPanel} className="flex h-full min-h-0 flex-col">
                <div
                  className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2"
                  style={{ WebkitAppRegion: "drag" }}
                >
                  <button
                    type="button"
                    onClick={() => setRightTab("files")}
                    className={cn(
                      "flex h-8 items-center gap-1 rounded-md px-2 text-xs font-normal",
                      rightTab === "files"
                        ? "bg-accent text-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground",
                    )}
                    style={{ WebkitAppRegion: "no-drag" }}
                  >
                    <FolderTree className="size-3.5" />
                    <span className="select-none">{t("sessionView.files")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab("terminal")}
                    className={cn(
                      "flex h-8 items-center gap-1 rounded-md px-2 text-xs font-normal",
                      rightTab === "terminal"
                        ? "bg-accent text-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground",
                    )}
                    style={{ WebkitAppRegion: "no-drag" }}
                  >
                    <SquareTerminal className="size-3.5" />
                    <span className="select-none">{t("sessionView.terminal")}</span>
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className={cn("h-full min-h-0", rightTab === "files" ? "block" : "hidden")}>
                    {activeProjectId && <FilePanel projectId={activeProjectId} />}
                  </div>
                  <div
                    className={cn("h-full min-h-0", rightTab === "terminal" ? "block" : "hidden")}
                  >
                    {activeProjectId && rightTab === "terminal" && (
                      <TerminalPanel
                        isActive={rightTab === "terminal"}
                        projectId={activeProjectId}
                      />
                    )}
                  </div>
                </div>
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : null}
      </main>

      <FilePreviewSheet
        open={isPreviewOpen}
        projectId={previewFile?.projectId ?? null}
        relativePath={previewFile?.relativePath ?? null}
        onClose={closePreview}
        panelWidth={rightPanelWidth}
      />
    </>
  );
}
