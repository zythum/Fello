import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../../store";
import type { ProjectInfo, SessionInfo } from "../../../shared/schema";
import { request, isWebUI } from "../../backend";
import { electron } from "../../electron";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMessage } from "../providers/message";
import { extractErrorMessage } from "@/lib/utils";
import {
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Globe,
  Home,
  Library,
  LoaderCircle,
  MessageCirclePlus,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react";

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  return extractErrorMessage(error) || fallbackMessage;
}

export function Sidebar() {
  const { t, i18n: _i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  const handleNavigate = (path: string) => {
    setOptimisticPath(path);
    setTimeout(() => {
      navigate(path);
    }, 0);
  };

  const currentPath = optimisticPath ?? location.pathname;
  const matchSession = currentPath.match(/^\/session-view\/(.+)$/);
  const activeSessionId = matchSession ? matchSession[1] : null;

  const {
    isMacApp,
    isFullScreen,
    projects,
    sessions,
    setProjects,
    setSessions,
    sidebarOpen,
    configuredAgents,
    sessionStates,
    webUIStatus,
  } = useAppStore();

  const enabledAgents = useMemo(
    () => configuredAgents.filter((a) => !a.disabled),
    [configuredAgents],
  );
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [openAgentMenuProjectId, setOpenAgentMenuProjectId] = useState<string | null>(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const { prompt, confirm, toast } = useMessage();

  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  if (!sidebarOpen) return null;

  const refreshData = async () => {
    const [nextProjects, nextSessions] = await Promise.all([
      request.listProjects(),
      request.listSessions(),
    ]);
    setProjects(nextProjects ?? []);
    setSessions(nextSessions ?? []);
    return {
      projects: nextProjects ?? [],
      sessions: nextSessions ?? [],
    };
  };

  const handleAddProject = async () => {
    try {
      let selectedPath = "";
      if (isWebUI) {
        const p = await prompt({
          title: t("sidebar.addProjectTitle", "Add Project"),
          content: t("sidebar.enterProjectPath", "Enter absolute path to project on the server:"),
          validate: (val) =>
            val.trim() ? undefined : t("sidebar.pathCannotBeEmpty", "Path cannot be empty"),
        });
        if (!p || p === "cancel") return;
        selectedPath = p.trim();
      } else {
        const p = await electron.showOpenDialog();
        if (!p) return;
        selectedPath = p;
      }

      const projectInfo = await request.addProject(selectedPath);
      await refreshData();
      setExpandedProjects((prev) => ({ ...prev, [projectInfo.id]: true }));
    } catch (err) {
      const message = getErrorMessage(err, t("sidebar.addProjectFailed", "Failed to add project."));
      if (message === "Project selection was canceled") return;
      toast.error(message);
    }
  };

  const handleNewChat = async (projectId: string, agentId: string) => {
    try {
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      useAppStore.getState().setIsCreatingSession(true);
      const result = await request.newSession({
        projectId,
        agentId,
      });
      await refreshData();
      handleNavigate(`/session-view/${result.sessionId}`);
    } catch (err) {
      console.error("Failed to create new chat:", err);
      toast.error(getErrorMessage(err, t("sidebar.newChatFailed", "Failed to create a new chat.")));
    } finally {
      useAppStore.getState().setIsCreatingSession(false);
    }
  };

  const handleSelectSession = async (session: SessionInfo) => {
    handleNavigate(`/session-view/${session.id}`);
  };

  const handleDeleteSession = async (session: SessionInfo) => {
    const displayTitle = session.title || t("sidebar.newChat", "New Chat");
    await confirm({
      title: t("sidebar.deleteChat"),
      content: t("sidebar.deleteChatConfirm", { title: displayTitle }),
      buttons: [
        { text: t("sidebar.cancel"), value: "cancel", variant: "outline" },
        {
          text: t("sidebar.delete"),
          variant: "destructive",
          value: async () => {
            await request.deleteSession(session.id);
            const map = new Map(useAppStore.getState().sessionStates);
            map.delete(session.id);
            useAppStore.setState({ sessionStates: map });
            const { sessions: updated } = await refreshData();
            if (activeSessionId === session.id) {
              const next = updated.length > 0 ? updated[0] : null;
              if (next) {
                handleNavigate(`/session-view/${next.id}`);
              } else {
                handleNavigate("/");
              }
            }
            return "deleted";
          },
        },
      ],
    });
  };

  const handleRenameProject = async (project: ProjectInfo) => {
    const newName = await prompt({
      title: t("sidebar.renameProject"),
      content: t("sidebar.enterNewProjectName"),
      defaultValue: project.title,
      validate: (val) =>
        val.trim() ? undefined : t("sidebar.projectNameEmpty", "Project name cannot be empty"),
    });

    if (newName && newName !== "cancel") {
      await request.renameProject({ projectId: project.id, title: newName.trim() });
      await refreshData();
    }
  };

  const handleRenameSession = async (session: SessionInfo) => {
    const displayTitle = session.title || t("sidebar.newChat", "New Chat");
    const newName = await prompt({
      title: t("sidebar.renameChat"),
      content: t("sidebar.enterNewChatName"),
      defaultValue: displayTitle,
      validate: (val) =>
        val.trim() ? undefined : t("sidebar.chatNameEmpty", "Chat name cannot be empty"),
    });

    if (newName && newName !== "cancel") {
      await request.updateSessionTitle({ sessionId: session.id, title: newName.trim() });
      await refreshData();
    }
  };

  const handleDeleteProject = async (project: ProjectInfo) => {
    await confirm({
      title: t("sidebar.deleteProject"),
      content: t("sidebar.deleteProjectConfirm", { title: project.title }),
      buttons: [
        { text: t("sidebar.cancel"), value: "cancel", variant: "outline" },
        {
          text: t("sidebar.delete"),
          value: async () => {
            await request.deleteProject(project.id);
            const map = new Map(useAppStore.getState().sessionStates);
            for (const session of sessions) {
              if (session.projectId === project.id) map.delete(session.id);
            }
            useAppStore.setState({ sessionStates: map });

            const { sessions: updated } = await refreshData();
            if (activeSessionId && !updated.some((session) => session.id === activeSessionId)) {
              const next = updated.length > 0 ? updated[0] : null;
              if (next) {
                handleNavigate(`/session-view/${next.id}`);
              } else {
                handleNavigate("/");
              }
            }
            return "confirm";
          },
          variant: "destructive",
        },
      ],
    });
  };

  const handleRevealProjectInFinder = async (project: ProjectInfo) => {
    try {
      await electron.revealInFinder(project.cwd);
    } catch (err) {
      toast.error(
        getErrorMessage(err, t("sidebar.revealInFinderFailed", "Failed to reveal in Finder.")),
      );
    }
  };

  const sessionsByProject = useMemo(() => {
    const grouped: Record<string, SessionInfo[]> = {};
    for (const session of sessions) {
      if (!grouped[session.projectId]) grouped[session.projectId] = [];
      grouped[session.projectId].push(session);
    }
    return grouped;
  }, [sessions]);

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? true;
  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !isProjectExpanded(projectId) }));
  };

  return (
    <aside className="flex h-full min-h-0 w-60 flex-col border-r border-border bg-sidebar text-sidebar-foreground pointer-events-auto">
      <div
        className={showMacTrafficLightSpace ? "h-10" : "h-0"}
        style={{ WebkitAppRegion: "drag" }}
      ></div>
      <div className="px-2 pt-2 pb-1">
        <div
          onClick={() => handleNavigate("/")}
          className={`group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
            currentPath === "/"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
          }`}
        >
          <Home className="size-3.5" />
          <span className="flex-1 truncate leading-normal select-none uppercase">
            {t("sidebar.welcome")}
          </span>
        </div>
        <div
          onClick={() => handleNavigate("/skills/installed")}
          className={`mt-0.5 group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
            currentPath.startsWith("/skills")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
          }`}
        >
          <Library className="size-3.5" />
          <span className="flex-1 truncate leading-normal select-none uppercase">
            {t("sidebar.skills")}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-2 pt-2">
        <span className="text-xs font-normal tracking-wide text-sidebar-foreground/40 uppercase select-none">
          {t("sidebar.projects")}
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
                  className={`group flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs font-normal text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/80 ${
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
                  <span className="flex-1 truncate leading-normal font-normal uppercase select-none">
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
                      aria-label={t("sidebar.projectActions", {
                        defaultValue: "Project actions for {{title}}",
                        title: project.title,
                      })}
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      onClick={(e) => e.stopPropagation()}
                      className="w-28"
                    >
                      {!isWebUI && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRevealProjectInFinder(project);
                          }}
                        >
                          <FolderOpen />
                          {t("sidebar.revealInFinder")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameProject(project);
                        }}
                      >
                        <Pencil />
                        {t("sidebar.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project);
                        }}
                      >
                        <Trash2 />
                        {t("sidebar.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {enabledAgents.length > 1 ? (
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
                        aria-label={t("sidebar.createChatInProject", {
                          defaultValue: "Create chat in {{title}}",
                          title: project.title,
                        })}
                      >
                        <MessageCirclePlus />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        onClick={(e) => e.stopPropagation()}
                        className="w-28"
                      >
                        {enabledAgents.map((agent) => (
                          <DropdownMenuItem
                            key={agent.id}
                            onClick={() => {
                              void handleNewChat(project.id, agent.id);
                            }}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span>{agent.id}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (enabledAgents.length === 1) {
                          void handleNewChat(project.id, enabledAgents[0].id);
                        } else {
                          handleNavigate("/settings/agents");
                        }
                      }}
                      className="flex size-4 items-center justify-center rounded-sm transition-opacity opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70"
                      aria-label={t("sidebar.createChatInProject", {
                        defaultValue: "Create chat in {{title}}",
                        title: project.title,
                      })}
                    >
                      <MessageCirclePlus />
                    </button>
                  )}
                </div>
                {expanded &&
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={`group flex h-8 cursor-default items-center justify-between rounded-md px-2 text-xs font-normal transition-colors ${
                        activeSessionId === session.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
                      } ${openSessionMenuId === session.id ? "bg-sidebar-accent" : ""}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <LoaderCircle
                          className={cn(
                            "size-3",
                            !sessionStates.get(session.id)?.isStreaming
                              ? "invisible"
                              : "animate-spin",
                          )}
                        />
                        <Badge
                          variant="outline"
                          className="px-1 -ml-1 text-[10px] uppercase max-w-15 truncate text-center leading-normal py-0 select-none"
                        >
                          {configuredAgents.find((a) => a.id === session.agentId)?.id ||
                            session.agentId}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate leading-normal select-none">
                          {session.title || t("sidebar.newChat", "New Chat")}
                        </span>
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
                            openSessionMenuId === session.id
                              ? "opacity-100 bg-sidebar-accent/25 text-sidebar-foreground/70"
                              : "opacity-0 group-hover:opacity-80 text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/75"
                          }`}
                          aria-label={t("sidebar.chatActions", {
                            defaultValue: "Chat actions for {{title}}",
                            title: session.title || t("sidebar.newChat", "New Chat"),
                          })}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          onClick={(e) => e.stopPropagation()}
                          className="w-28"
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameSession(session);
                            }}
                          >
                            <Pencil />
                            {t("sidebar.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSession(session);
                            }}
                          >
                            <Trash2 />
                            {t("sidebar.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
              </div>
            );
          })}
          {projects.length === 0 && (
            <p className="mt-4 text-center text-xs text-muted-foreground select-none">
              {t("sidebar.noProjects")}
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="mt-auto border-t border-border">
        <Button
          variant="ghost"
          onClick={() => handleNavigate("/settings/general")}
          className={cn(
            "flex w-full font-normal items-center justify-between gap-2 rounded-none border-0 text-xs h-8",
            currentPath.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/90 outline-none",
          )}
        >
          <div className="flex items-center gap-2">
            <Settings className="size-3.5" />
            {t("sidebar.settings")}
          </div>
          {webUIStatus.enabled && (
            <div title={t("sidebar.webuiEnabled", "WebUI Enabled")}>
              <Globe className="size-3 text-green-500" />
            </div>
          )}
        </Button>
      </div>
    </aside>
  );
}
