import { useMemo, useState } from "react";
import { useAppStore, type ProjectInfo, type SessionInfo } from "../store";
import { request } from "../backend";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderOpen,
  FolderClosed,
  MessageCirclePlus,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";

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
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);

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

  const handleDeleteSession = async (id: string) => {
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

  const handleRenameSession = async (session: SessionInfo) => {
    const nextTitle = window.prompt("Rename chat", session.title);
    if (nextTitle == null) return;
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      pushGlobalErrorMessage("Chat name cannot be empty.");
      return;
    }
    await request.updateSessionTitle({ sessionId: session.id, title: normalizedTitle });
    await refreshData();
  };

  const handleRenameProject = async (project: ProjectInfo) => {
    const nextTitle = window.prompt("Rename project", project.title);
    if (nextTitle == null) return;
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      pushGlobalErrorMessage("Project name cannot be empty.");
      return;
    }
    await request.renameProject({ projectId: project.id, title: normalizedTitle });
    await refreshData();
  };

  const handleDeleteProject = async (project: ProjectInfo) => {
    const shouldDelete = window.confirm(
      `Delete project "${project.title}" and all chats in it? This action cannot be undone.`,
    );
    if (!shouldDelete) return;
    await request.deleteProject(project.id);
    const map = new Map(useAppStore.getState().sessionStates);
    for (const session of sessions) {
      if (session.project_id === project.id) map.delete(session.id);
    }
    useAppStore.setState({ sessionStates: map });
    const { sessions: updated } = await refreshData();
    if (activeSessionId && !updated.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(updated.length > 0 ? updated[0].id : null);
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
    <aside className="flex h-full w-64 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-[10px] font-medium tracking-wide text-sidebar-foreground/35 uppercase">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-4 text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70"
          onClick={handleAddProject}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-1.5">
          {projects.map((project) => {
            const projectSessions = sessionsByProject[project.id] ?? [];
            const expanded = isProjectExpanded(project.id);
            return (
              <div key={project.id} className="space-y-0.5">
                <div
                  onClick={() => toggleProject(project.id)}
                  className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/80 ${
                    openProjectMenuId === project.id ? "bg-sidebar-accent/25 text-sidebar-foreground/80" : ""
                  }`}
                >
                  {expanded ? (
                    <FolderOpen className="size-3.5" />
                  ) : (
                    <FolderClosed className="size-3.5" />
                  )}
                  <span className="flex-1 truncate leading-normal uppercase" title={project.cwd}>
                    {project.title}
                  </span>
                  <DropdownMenu
                    onOpenChange={(open) => {
                      setOpenProjectMenuId((prev) =>
                        open ? project.id : prev === project.id ? null : prev,
                      );
                    }}
                  >
                    <DropdownMenuTrigger
                      onClick={(e) => e.stopPropagation()}
                      className={`flex size-4 items-center justify-center rounded-sm transition-opacity ${
                        openProjectMenuId === project.id
                          ? "opacity-100 bg-sidebar-accent/25 text-sidebar-foreground/70"
                          : "opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70"
                      }`}
                      aria-label={`Project actions for ${project.title}`}
                    >
                      <MoreHorizontal className="size-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      onClick={(e) => e.stopPropagation()}
                      className="w-28"
                    >
                      <DropdownMenuItem
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRenameProject(project);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteProject(project);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleNewChat(project.id);
                    }}
                    size="icon-sm"
                    variant="ghost"
                    className="size-4 opacity-0 transition-opacity group-hover:opacity-100 text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70"
                    aria-label={`Create chat in ${project.title}`}
                  >
                    <MessageCirclePlus className="size-3" />
                  </Button>
                </div>
                {expanded &&
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={`group flex h-8 cursor-pointer items-center justify-between rounded-md px-2 ml-4 text-xs font-medium transition-colors ${
                        activeSessionId === session.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground/95"
                      } ${openSessionMenuId === session.id ? "bg-sidebar-accent/35" : ""}`}
                    >
                      <span className="flex-1 truncate leading-normal">{session.title}</span>
                      <DropdownMenu
                        onOpenChange={(open) => {
                          setOpenSessionMenuId((prev) =>
                            open ? session.id : prev === session.id ? null : prev,
                          );
                        }}
                      >
                        <DropdownMenuTrigger
                          onClick={(e) => e.stopPropagation()}
                          className={`ml-1.5 flex size-4 items-center justify-center rounded-sm transition-opacity ${
                            openSessionMenuId === session.id || activeSessionId === session.id
                              ? "opacity-100 bg-sidebar-accent/25 text-sidebar-foreground/70"
                              : "opacity-0 group-hover:opacity-80 text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/75"
                          }`}
                          aria-label={`Chat actions for ${session.title}`}
                        >
                          <MoreHorizontal className="size-3" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          onClick={(e) => e.stopPropagation()}
                          className="w-28"
                        >
                          <DropdownMenuItem
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRenameSession(session);
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSession(session.id);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
    </aside>
  );
}
