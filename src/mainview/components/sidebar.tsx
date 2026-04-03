import { useMemo, useState, type MouseEvent } from "react";
import { useAppStore, type ProjectInfo, type SessionInfo } from "../store";
import { request } from "../backend";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FolderOpen, FolderClosed, MessageCirclePlus, FolderPlus, X } from "lucide-react";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Failed to create a new chat.";
}

export function Sidebar() {
  const {
    projects,
    sessions,
    activeSessionId,
    setActiveSessionId,
    setProjects,
    setSessions,
    setIsConnecting,
    pushGlobalErrorMessage,
    sidebarOpen,
    resetSessionState,
  } = useAppStore();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  if (!sidebarOpen) return null;

  const applyModels = (models: { availableModels: any[]; currentModelId: string } | null) => {
    if (!models) return;
    useAppStore.getState().setAvailableModels(models.availableModels);
    useAppStore.getState().setCurrentModelId(models.currentModelId);
  };

  const refreshData = async () => {
    const [nextProjects, nextSessions] = await Promise.all([
      request.listProjects(),
      request.listSessions(),
    ]);
    setProjects((nextProjects as ProjectInfo[]) ?? []);
    setSessions((nextSessions as SessionInfo[]) ?? []);
    return {
      projects: (nextProjects as ProjectInfo[]) ?? [],
      sessions: (nextSessions as SessionInfo[]) ?? [],
    };
  };

  const handleAddProject = async () => {
    try {
      const result = (await request.addProject()) as { project: ProjectInfo; created: boolean };
      if (!result.created) {
        pushGlobalErrorMessage("Project already exists.");
        return;
      }
      await refreshData();
      setExpandedProjects((prev) => ({ ...prev, [result.project.id]: true }));
    } catch (err) {
      const message = getErrorMessage(err);
      if (message === "Project selection was canceled") return;
      pushGlobalErrorMessage(message);
    }
  };

  const handleNewChat = async (projectId: string) => {
    try {
      setIsConnecting(true);
      const result = (await request.newSession({ projectId })) as {
        sessionId: string;
        models: { availableModels: any[]; currentModelId: string } | null;
      } | null;
      if (!result) return;
      setActiveSessionId(result.sessionId);
      applyModels(result.models);
      await refreshData();
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
      const result = (await request.loadSession({ sessionId: session.id })) as {
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

  const handleDeleteSession = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    await request.deleteSession(id);
    const map = new Map(useAppStore.getState().sessionStates);
    map.delete(id);
    useAppStore.setState({ sessionStates: map });
    const { sessions: updated } = await refreshData();
    if (activeSessionId === id) {
      const next = updated.length > 0 ? updated[0].id : null;
      setActiveSessionId(next);
    }
  };

  const sessionsByProject = useMemo(() => {
    const grouped: Record<string, SessionInfo[]> = {};
    for (const session of sessions) {
      if (!grouped[session.project_id]) grouped[session.project_id] = [];
      grouped[session.project_id].push(session);
    }
    return grouped;
  }, [sessions]);

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? true;
  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !isProjectExpanded(projectId) }));
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-3">
        <span className="text-sm font-medium">Projects</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={handleAddProject}>
          <FolderPlus className="size-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {projects.map((project) => {
            const projectSessions = sessionsByProject[project.id] ?? [];
            const expanded = isProjectExpanded(project.id);
            return (
              <div key={project.id} className="space-y-1">
                <div
                  onClick={() => toggleProject(project.id)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                >
                  {expanded ? (
                    <FolderOpen className="size-4" />
                  ) : (
                    <FolderClosed className="size-4" />
                  )}
                  <span className="flex-1 truncate" title={project.cwd}>
                    {project.title}
                  </span>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleNewChat(project.id);
                    }}
                    size="icon-sm"
                    variant="ghost"
                    className="-mr-2"
                    aria-label={`Create chat in ${project.title}`}
                  >
                    <MessageCirclePlus className="size-3.5" />
                  </Button>
                </div>
                {expanded &&
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                        activeSessionId === session.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <span className="flex-1 truncate">{session.title}</span>
                      <button
                        onClick={(e) => void handleDeleteSession(e, session.id)}
                        className="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Delete session ${session.title}`}
                      >
                        <X className="size-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
              </div>
            );
          })}
          {projects.length === 0 && (
            <p className="mt-4 text-center text-xs text-muted-foreground">No projects yet</p>
          )}
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-3 text-xs text-muted-foreground">Fello · ACP Client</div>
    </aside>
  );
}
