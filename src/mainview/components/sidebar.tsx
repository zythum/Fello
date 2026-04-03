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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderOpen,
  FolderClosed,
  MessageCirclePlus,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
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
  const [openAgentMenuProjectId, setOpenAgentMenuProjectId] = useState<string | null>(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    | { type: "project"; id: string; title: string }
    | { type: "session"; id: string; title: string }
    | null
  >(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteProject, setPendingDeleteProject] = useState<ProjectInfo | null>(null);

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

  const handleNewChat = async (projectId: string, agent: "kiro" | "kimi") => {
    try {
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      setIsConnecting(true);
      const result = (await request.newSession({ projectId, agent })) as {
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

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const normalizedTitle = renameValue.trim();
    if (!normalizedTitle) {
      pushGlobalErrorMessage(
        renameTarget.type === "session" ? "Chat name cannot be empty." : "Project name cannot be empty.",
      );
      return;
    }
    if (renameTarget.type === "session") {
      await request.updateSessionTitle({ sessionId: renameTarget.id, title: normalizedTitle });
    } else {
      await request.renameProject({ projectId: renameTarget.id, title: normalizedTitle });
    }
    setRenameTarget(null);
    setRenameValue("");
    await refreshData();
  };

  const handleRenameProject = (project: ProjectInfo) => {
    setRenameTarget({ type: "project", id: project.id, title: project.title });
    setRenameValue(project.title);
  };

  const handleRenameSession = (session: SessionInfo) => {
    setRenameTarget({ type: "session", id: session.id, title: session.title });
    setRenameValue(session.title);
  };

  const handleDeleteProject = (project: ProjectInfo) => {
    setPendingDeleteProject(project);
  };

  const handleRevealProjectInFinder = async (project: ProjectInfo) => {
    try {
      await request.revealInFinder(project.cwd);
    } catch (err) {
      pushGlobalErrorMessage(getErrorMessage(err));
    }
  };

  const handleConfirmDeleteProject = async () => {
    if (!pendingDeleteProject) return;
    await request.deleteProject(pendingDeleteProject.id);
    const map = new Map(useAppStore.getState().sessionStates);
    for (const session of sessions) {
      if (session.project_id === pendingDeleteProject.id) map.delete(session.id);
    }
    useAppStore.setState({ sessionStates: map });
    setPendingDeleteProject(null);
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
    <aside className="flex h-full min-h-0 w-60 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-1.5">
          {projects.map((project) => {
            const projectSessions = sessionsByProject[project.id] ?? [];
            const expanded = isProjectExpanded(project.id);
            return (
              <div key={project.id} className="space-y-0.5">
                <div
                  onClick={() => toggleProject(project.id)}
                  className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/80 ${
                    openProjectMenuId === project.id || openAgentMenuProjectId === project.id
                      ? "bg-sidebar-accent/25 text-sidebar-foreground/80"
                      : ""
                  }`}
                >
                  {expanded ? (
                    <FolderOpen className="size-3.5" />
                  ) : (
                    <FolderClosed className="size-3.5" />
                  )}
                  <span className="flex-1 truncate leading-normal font-normal uppercase" title={project.cwd}>
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
                      className="w-28 py-1"
                    >
                      <DropdownMenuItem
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRevealProjectInFinder(project);
                        }}
                      >
                        <FolderOpen className="size-3" />
                        Reveal in Finder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameProject(project);
                        }}
                      >
                        <Pencil className="size-3" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project);
                        }}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu
                    onOpenChange={(open) => {
                      setOpenAgentMenuProjectId((prev) =>
                        open ? project.id : prev === project.id ? null : prev,
                      );
                    }}
                  >
                    <DropdownMenuTrigger
                      onClick={(e) => e.stopPropagation()}
                      className={`flex size-4 items-center justify-center rounded-sm transition-opacity ${
                        openAgentMenuProjectId === project.id
                          ? "opacity-100 bg-sidebar-accent/25 text-sidebar-foreground/70"
                          : "opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70"
                      }`}
                      aria-label={`Create chat in ${project.title}`}
                    >
                      <MessageCirclePlus className="size-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      onClick={(e) => e.stopPropagation()}
                      className="w-28 py-1"
                    >
                      <DropdownMenuItem
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={() => {
                          void handleNewChat(project.id, "kiro");
                        }}
                      >
                        Kiro
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={() => {
                          void handleNewChat(project.id, "kimi");
                        }}
                      >
                        Kimi
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {expanded &&
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={`group flex h-8 cursor-pointer items-center justify-between rounded-md px-2 ml-3 text-xs font-medium transition-colors ${
                        activeSessionId === session.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground/95"
                      } ${openSessionMenuId === session.id ? "bg-sidebar-accent/35" : ""}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
                          {session.agent}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate leading-normal">{session.title}</span>
                      </div>
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
                          className="w-28 py-1"
                        >
                          <DropdownMenuItem
                            className="text-xs rounded-1 text-muted-foreground/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameSession(session);
                            }}
                          >
                            <Pencil className="size-3" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            className="text-xs rounded-1 text-muted-foreground/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSession(session.id);
                            }}
                          >
                            <Trash2 className="size-3" />
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
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{renameTarget?.type === "session" ? "Rename Chat" : "Rename Project"}</DialogTitle>
            <DialogDescription>
              {renameTarget?.type === "session"
                ? "Enter a new chat name."
                : "Enter a new project name."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRenameSubmit();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleRenameSubmit()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDeleteProject !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteProject(null);
        }}
        disablePointerDismissal
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              {pendingDeleteProject
                ? `Delete project "${pendingDeleteProject.title}" and all chats in it? This action cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteProject(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDeleteProject()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
