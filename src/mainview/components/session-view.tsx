import { useState } from "react";
import { useAppStore } from "../store";
import { Chat } from "./chat";
import { FilePanel } from "./file-panel";
import { TerminalPanel } from "./terminal-panel";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { PanelLeft, Loader2, MessageSquare, FolderTree, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionView() {
  const { activeSessionId, sidebarOpen, setSidebarOpen, isConnecting } = useAppStore();
  const [rightTab, setRightTab] = useState<"files" | "terminal">("files");

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

        {isConnecting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Connecting to agent...</p>
          </div>
        ) : activeSessionId ? (
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize={70} minSize={30}>
              <div className="flex h-full flex-col">
                <Chat />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={15}>
              <aside className="flex h-full flex-col bg-sidebar">
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
                    <span>Files</span>
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
                    <span>Terminal</span>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className={cn("h-full", rightTab === "files" ? "block" : "hidden")}>
                    <FilePanel />
                  </div>
                  <div className={cn("h-full", rightTab === "terminal" ? "block" : "hidden")}>
                    <TerminalPanel isActive={rightTab === "terminal"} />
                  </div>
                </div>
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquare className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Fello</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                An ACP client for Kiro. Start a new chat from the sidebar to connect with the agent
                and begin collaborating.
              </p>
            </div>
            <span className="text-xs text-muted-foreground/60">
              Powered by Agent Client Protocol
            </span>
          </div>
        )}
      </main>
    </>
  );
}
