import { useAppStore, type SessionInfo } from "../store";
import { rpc } from "../rpc";
import { replayEvents } from "../lib/process-event";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, X } from "lucide-react";

export function Sidebar() {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    setSessions,
    setIsConnecting,
    sidebarOpen,
  } = useAppStore();

  if (!sidebarOpen) return null;

  const handleNewChat = async () => {
    try {
      const cwd = (await rpc.pickWorkDir()) as string | null;
      if (!cwd) return;
      setIsConnecting(true);
      useAppStore.getState().setStreamingContent("");
      useAppStore.getState().setThinkingContent("");
      useAppStore.getState().clearToolCalls();
      useAppStore.getState().setMessages([]);
      const result = (await rpc.newChat(cwd)) as { sessionId: string } | null;
      if (!result) return;
      setActiveSessionId(result.sessionId);
      const models = await rpc.getModels();
      if (models) {
        useAppStore.getState().setAvailableModels(models.availableModels as any);
        useAppStore.getState().setCurrentModelId(models.currentModelId);
      }
      const updated = ((await rpc.listSessions()) as SessionInfo[]) ?? [];
      setSessions(updated);
    } catch (err) {
      console.error("Failed to create new chat:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSelectSession = async (session: SessionInfo) => {
    setActiveSessionId(session.id);
    setIsConnecting(true);
    try {
      const events = (await rpc.getEvents(session.id)) as unknown[];
      replayEvents(events);
      const result = (await rpc.resumeChat(session.id, session.cwd)) as {
        ok: boolean;
        models: { availableModels: any[]; currentModelId: string } | null;
      } | null;
      if (result?.ok && result.models) {
        useAppStore.getState().setAvailableModels(result.models.availableModels);
        useAppStore.getState().setCurrentModelId(result.models.currentModelId);
      }
    } catch (err) {
      console.error("Failed to load session:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await rpc.deleteSession(id);
    const updated = ((await rpc.listSessions()) as SessionInfo[]) ?? [];
    setSessions(updated);
    if (activeSessionId === id) {
      // Select the most recent remaining session, or null
      const next = updated.length > 0 ? updated[0].id : null;
      setActiveSessionId(next);
      useAppStore.getState().setMessages([]);
      useAppStore.getState().clearToolCalls();
      if (next) {
        const events = (await rpc.getEvents(next)) as unknown[];
        replayEvents(events);
      }
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
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </p>
          )}
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-3 text-xs text-muted-foreground">Cowork · ACP Client</div>
    </aside>
  );
}
