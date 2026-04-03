import { useAppStore, type SessionInfo } from "../store";
import { request } from "../backend";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, X } from "lucide-react";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Failed to create a new chat.";
}

export function Sidebar() {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    setSessions,
    setIsConnecting,
    pushGlobalErrorMessage,
    sidebarOpen,
    resetSessionState,
  } = useAppStore();

  if (!sidebarOpen) return null;

  const applyModels = (models: { availableModels: any[]; currentModelId: string } | null) => {
    if (!models) return;
    useAppStore.getState().setAvailableModels(models.availableModels);
    useAppStore.getState().setCurrentModelId(models.currentModelId);
  };

  const handleNewChat = async () => {
    try {
      const cwd = (await request.pickWorkDir()) as string | null;
      if (!cwd) return;
      setIsConnecting(true);
      const result = (await request.newSession(cwd)) as {
        sessionId: string;
        models: { availableModels: any[]; currentModelId: string } | null;
      } | null;
      if (!result) return;
      setActiveSessionId(result.sessionId);
      applyModels(result.models);
      const updated = ((await request.listSessions()) as SessionInfo[]) ?? [];
      setSessions(updated);
    } catch (err) {
      console.error("Failed to create new chat:", err);
      pushGlobalErrorMessage(getErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSelectSession = async (session: SessionInfo) => {
    resetSessionState(session.id);
    setActiveSessionId(session.id);
    setIsConnecting(true);
    try {
      const result = (await request.loadSession({ sessionId: session.id, cwd: session.cwd })) as {
        sessionId: string;
        models: { availableModels: any[]; currentModelId: string } | null;
      } | null;
      if (!result) return;
      applyModels(result.models);
    } catch (err) {
      console.error("Failed to load session:", err);
      pushGlobalErrorMessage(getErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await request.deleteSession(id);
    // Remove per-session state
    const map = new Map(useAppStore.getState().sessionStates);
    map.delete(id);
    useAppStore.setState({ sessionStates: map });

    const updated = ((await request.listSessions()) as SessionInfo[]) ?? [];
    setSessions(updated);
    if (activeSessionId === id) {
      const next = updated.length > 0 ? updated[0].id : null;
      setActiveSessionId(next);
    }
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <Button onClick={handleNewChat} className="w-full gap-2">
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => handleSelectSession(session)}
              className={`group flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                activeSessionId === session.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              }`}
            >
              <span className="flex-1 truncate">{session.title}</span>
              <button
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Delete session ${session.title}`}
              >
                <X className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="mt-4 text-center text-xs text-muted-foreground">No conversations yet</p>
          )}
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-3 text-xs text-muted-foreground">Fello · ACP Client</div>
    </aside>
  );
}
