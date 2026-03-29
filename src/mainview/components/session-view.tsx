import { useAppStore, useActiveSessionState, type SessionInfo } from "../store";
import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { FileTree } from "./file-tree";
import { Button } from "@/components/ui/button";
import { PanelLeft, Folder, Loader2, MessageSquare } from "lucide-react";
import { request } from "../backend";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(cost: { amount: number; currency: string }): string {
  return `${cost.currency} ${cost.amount.toFixed(4)}`;
}

export function SessionView() {
  const { sessions, activeSessionId, sidebarOpen, setSidebarOpen, isConnecting, setSessions } =
    useAppStore();

  const { usage } = useActiveSessionState();
  const session = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleChangeCwd = async () => {
    if (!session) return;
    try {
      const result = (await request.changeWorkDir({ sessionId: session.id })) as {
        ok: boolean;
        cwd: string | null;
      };
      if (result.ok && result.cwd) {
        const updated = ((await request.listSessions()) as SessionInfo[]) ?? [];
        setSessions(updated);
      }
    } catch (err) {
      console.error("Failed to change work dir:", err);
    }
  };

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/50 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-4" />
          </Button>
          {session && (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={`${session.cwd} (click to change)`}
              onClick={handleChangeCwd}
            >
              <Folder className="size-3 shrink-0" />
              <span className="max-w-[200px] truncate">
                {(() => {
                  const parts = session.cwd.split("/").filter(Boolean);
                  if (parts.length <= 5) return session.cwd;
                  return "/" + [...parts.slice(0, 2), "...", ...parts.slice(-2)].join("/");
                })()}
              </span>
            </button>
          )}
          {usage && usage.used > 0 && (
            <span
              className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground"
              title={`Used: ${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens${usage.cost ? ` · Cost: ${formatCost(usage.cost)}` : ""}`}
            >
              <span>
                {formatTokens(usage.used)} / {formatTokens(usage.size)}
              </span>
              {usage.cost && (
                <span className="text-muted-foreground/60">{formatCost(usage.cost)}</span>
              )}
            </span>
          )}
          <span
            className={`text-xs text-muted-foreground${usage && usage.used > 0 ? "" : " ml-auto"}`}
          >
            Kiro ACP
          </span>
        </header>

        {isConnecting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Connecting to agent...</p>
          </div>
        ) : session ? (
          <>
            <ChatArea />
            <ChatInput />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquare className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Cowork</h1>
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

      {session && !isConnecting && (
        <aside className="flex h-full w-64 flex-col border-l border-border bg-sidebar">
          <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
            <span className="text-xs font-medium text-sidebar-foreground">Files</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <FileTree />
          </div>
        </aside>
      )}
    </>
  );
}
