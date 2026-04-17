import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, useActiveSessionState } from "../store";
import { Chat } from "./chat";
import { FilePanel } from "./file-panel";
import { TerminalPanel } from "./terminal-panel";
import { FilePreviewSheet } from "./file-preview";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Loader2, MessageSquare, FolderTree, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionView() {
  const { t } = useTranslation();
  const { activeSessionId, sessions, isCreatingSession } = useAppStore();
  const { isLoading } = useActiveSessionState();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeProjectId = activeSession?.projectId;
  const [rightTab, setRightTab] = useState<"files" | "terminal">("files");

  const [rightPanel, setRightPanel] = useState<HTMLElement | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(0);
  const [previewFile, setPreviewFile] = useState<{
    projectId: string;
    relativePath: string;
  } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [activeSessionId]);

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
        {!activeSessionId && (isLoading || isCreatingSession) ? (
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
        ) : activeSessionId ? (
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize={700} minSize={300}>
              <div className="relative flex h-full flex-col">
                <Chat />
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
                    {activeProjectId && (
                      <FilePanel
                        projectId={activeProjectId}
                        onPreviewFile={(file) => {
                          if (previewCloseTimeoutRef.current) {
                            clearTimeout(previewCloseTimeoutRef.current);
                            previewCloseTimeoutRef.current = null;
                          }
                          setPreviewFile(file);
                          setIsPreviewOpen(true);
                        }}
                      />
                    )}
                  </div>
                  <div
                    className={cn("h-full min-h-0", rightTab === "terminal" ? "block" : "hidden")}
                  >
                    {activeProjectId && (
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
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 relative">
            <div
              className="absolute left-0 top-0 right-0 h-12"
              style={{ WebkitAppRegion: "drag" }}
            />
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquare className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("sessionView.welcomeTitle")}
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {t("sessionView.welcomeDesc")}
              </p>
            </div>
            <span className="text-xs text-muted-foreground/60">{t("sessionView.poweredBy")}</span>
          </div>
        )}
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
