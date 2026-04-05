import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { Chat } from "./chat";
import { FilePanel } from "./file-panel";
import { TerminalPanel } from "./terminal-panel";
import { FilePreviewSheet } from "./file-preview";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { PanelLeft, Loader2, MessageSquare, FolderTree, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionView() {
  const { t } = useTranslation();
  const { activeSessionId, sidebarOpen, setSidebarOpen, isConnecting } = useAppStore();
  const [rightTab, setRightTab] = useState<"files" | "terminal">("files");

  const [rightPanel, setRightPanel] = useState<HTMLElement | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(0);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);

  useEffect(() => {
    setPreviewFilePath(null);
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
        {!sidebarOpen && (
          <div className="absolute top-2 left-2 z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="size-4" />
            </Button>
          </div>
        )}

        {!activeSessionId && isConnecting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-normal text-muted-foreground/50">
              {t("sessionView.connecting")}
            </p>
          </div>
        ) : activeSessionId ? (
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize={70} minSize={30}>
              <div className="relative flex h-full flex-col">
                <Chat />
                {isConnecting && (
                  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/10">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="text-sm font-normal text-foreground/50">
                      {t("sessionView.connecting")}
                    </p>
                  </div>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={30} minSize={15}>
              <aside ref={setRightPanel} className="flex h-full min-h-0 flex-col bg-sidebar">
                <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
                  <button
                    type="button"
                    onClick={() => setRightTab("files")}
                    className={cn(
                      "flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium",
                      rightTab === "files"
                        ? "bg-accent text-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <FolderTree className="size-3.5" />
                    <span>{t("sessionView.files")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab("terminal")}
                    className={cn(
                      "flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium",
                      rightTab === "terminal"
                        ? "bg-accent text-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <SquareTerminal className="size-3.5" />
                    <span>{t("sessionView.terminal")}</span>
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className={cn("h-full min-h-0", rightTab === "files" ? "block" : "hidden")}>
                    <FilePanel onPreviewFile={setPreviewFilePath} />
                  </div>
                  <div
                    className={cn("h-full min-h-0", rightTab === "terminal" ? "block" : "hidden")}
                  >
                    <TerminalPanel isActive={rightTab === "terminal"} />
                  </div>
                </div>
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex flex-1 flex-col items-center bg-sidebar justify-center gap-6 px-8">
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
        filePath={previewFilePath}
        onClose={() => setPreviewFilePath(null)}
        panelWidth={rightPanelWidth}
      />
    </>
  );
}
