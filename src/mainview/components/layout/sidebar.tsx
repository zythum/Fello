import { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../../store";
import type { ProjectInfo, SessionInfo, Feature } from "../../../shared/schema";
import { ALL_FEATURES, FEATURE_I18N_KEYS, EDITOR_LABELS } from "../../../shared/constants";
import { request, isWebUI } from "../../backend";
import { electron } from "../../electron";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useMessage } from "../providers/message";
import {
  closeSession,
  deleteProject,
  deleteSession,
  newSession,
  renameSession,
  restartSession,
  RestartSessionError,
  SessionLifecycleBusyError,
} from "../../lib/session-lifecycle";
import { extractErrorMessage } from "@/lib/utils";
import {
  CalendarDays,
  Check,
  Clock,
  Code,
  Bot,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Globe,
  HelpCircle,
  Home,
  Library,
  LoaderCircle,
  MessageCircle,
  MessageCirclePlus,
  Pencil,
  Power,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  ClockCheck,
} from "lucide-react";

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  return extractErrorMessage(error) || fallbackMessage;
}

/** 相对时间显示：分钟/小时/天，超过 30 天回退到本地化日期 */
function formatRelativeTime(timestamp: number, language: string): string {
  const diff = Date.now() - timestamp;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return rtf.format(0, "minute");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return new Date(timestamp).toLocaleDateString(language);
}

/** HoverCard 展开态标识：项目用 p: 前缀，会话用 s: 前缀，避免命名空间碰撞 */
function projectHoverId(id: string): string {
  return `p:${id}`;
}
function sessionHoverId(id: string): string {
  return `s:${id}`;
}

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  // Listen for add-project event from Welcome page
  const handleAddProjectRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const handler = () => handleAddProjectRef.current?.();
    window.addEventListener("fello:add-project", handler);
    return () => window.removeEventListener("fello:add-project", handler);
  }, []);

  // Listen for new-session event from Welcome page
  const handleNewSessionRef = useRef<((projectId: string) => void) | undefined>(undefined);
  useEffect(() => {
    const handler = (e: Event) => {
      const projectId = (e as CustomEvent).detail?.projectId;
      if (projectId) handleNewSessionRef.current?.(projectId);
    };
    window.addEventListener("fello:new-session", handler);
    return () => window.removeEventListener("fello:new-session", handler);
  }, []);

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
    configuredMcpServers,
    sessionStates,
    webUIStatus,
    ilinkStatus,
    activeIlinkSessionId,
  } = useAppStore();

  // Auto-clear completedAt after 3 seconds for the active session
  const completedAtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (!sessions.some((s) => s.id === activeSessionId)) return; // Session deleted

    const state = useAppStore.getState().sessionStates.get(activeSessionId);
    if (state?.completedAt) {
      if (completedAtTimerRef.current) {
        clearTimeout(completedAtTimerRef.current);
      }
      completedAtTimerRef.current = setTimeout(() => {
        useAppStore.getState().updateSessionState(activeSessionId, () => ({
          completedAt: null,
          completedStatus: null,
        }));
        completedAtTimerRef.current = null;
      }, 3000);
    }

    return () => {
      if (completedAtTimerRef.current) {
        clearTimeout(completedAtTimerRef.current);
        completedAtTimerRef.current = null;
      }
    };
  }, [activeSessionId, sessionStates, sessions]);

  const enabledAgents = useMemo(
    () => configuredAgents.filter((a) => !a.disabled),
    [configuredAgents],
  );
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<
    { id: string; type: "restart" | "close" | "delete" } | null
  >(null);
  // 记录鼠标当前悬停的条目（用于右键菜单关闭后恢复 hover 卡片，避免出现后立即消失的闪现）
  const hoveredTriggerIdRef = useRef<string | null>(null);

  const { prompt, confirm, toast } = useMessage();

  const handleSetActiveIlinkSession = async (sessionId: string) => {
    try {
      await request.setActiveIlinkSession({ sessionId });
    } catch (err) {
      console.error("Failed to update WeChat active session:", err);
      toast.error(
        extractErrorMessage(err) ||
          t("sidebar.failedToUpdateIlinkSession", "Failed to update WeChat active session."),
      );
    }
  };

  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

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
        if (!p) return;
        selectedPath = p.trim();
      } else {
        const p = await electron.showOpenDialog();
        if (!p) return;
        selectedPath = p;
      }

      const projectInfo = await request.addProject(selectedPath);
      await refreshData();
      setExpandedProjects((prev) => ({ ...prev, [projectInfo.id]: true }));
      // 自动弹出创建 session 弹层
      openNewSessionDialog(projectInfo.id);
    } catch (err) {
      const message = getErrorMessage(err, t("sidebar.addProjectFailed", "Failed to add project."));
      if (message === "Project selection was canceled") return;
      toast.error(message);
    }
  };

  handleAddProjectRef.current = handleAddProject;

  const handleNewSession = async (
    projectId: string,
    agentId: string,
    params?: { mcpServers?: string[]; features?: Feature[]; permissionMode?: "ask" | "allow-all" },
  ): Promise<boolean> => {
    try {
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      useAppStore.getState().setIsCreatingSession(true);
      const sessionId = await newSession({
        projectId,
        agentId,
        mcpServers: params?.mcpServers,
        features: params?.features,
        permissionMode: params?.permissionMode,
      });
      await refreshData();
      handleNavigate(`/session-view/${sessionId}`);
      return true;
    } catch (err) {
      console.error("Failed to create new session:", err);
      toast.error(getErrorMessage(err, t("sidebar.newSessionFailed", "Failed to create a new session.")));
      return false;
    } finally {
      useAppStore.getState().setIsCreatingSession(false);
    }
  };

  const creating = useAppStore((s) => s.isCreatingSession);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
  const [newSessionAgentId, setNewSessionAgentId] = useState<string>("");
  const [newSessionMcpIds, setNewSessionMcpIds] = useState<Set<string>>(new Set());
  const [newSessionFeatures, setNewSessionFeatures] = useState<Feature[]>(ALL_FEATURES);
  const [newSessionPermissionMode, setNewSessionPermissionMode] = useState<"ask" | "allow-all">(
    "allow-all",
  );

  const openNewSessionDialog = (projectId: string) => {
    if (enabledAgents.length === 0) {
      handleNavigate("/settings/agents");
      return;
    }
    setNewSessionProjectId(projectId);
    setNewSessionAgentId(enabledAgents[0]?.id ?? "");
    setNewSessionMcpIds(new Set(configuredMcpServers.filter((s) => !s.disabled).map((s) => s.id)));
    setNewSessionFeatures(ALL_FEATURES);
    setNewSessionPermissionMode("allow-all");
    setNewSessionDialogOpen(true);
  };

  handleNewSessionRef.current = openNewSessionDialog;

  const handleCreateNewSession = async () => {
    if (!newSessionProjectId || !newSessionAgentId) return;
    const ok = await handleNewSession(newSessionProjectId, newSessionAgentId, {
      mcpServers: Array.from(newSessionMcpIds),
      features: newSessionFeatures,
      permissionMode: newSessionPermissionMode,
    });
    if (ok) setNewSessionDialogOpen(false);
  };

  const handleSelectSession = async (session: SessionInfo) => {
    // Clear completed state when user navigates to a completed session
    const state = useAppStore.getState().sessionStates.get(session.id);
    if (state?.completedAt) {
      useAppStore.getState().updateSessionState(session.id, () => ({
        completedAt: null,
        completedStatus: null,
      }));
    }
    handleNavigate(`/session-view/${session.id}`);
  };

  const handleRestartSession = async (session: SessionInfo) => {
    if (sessionAction) return;
    setSessionAction({ id: session.id, type: "restart" });
    try {
      await restartSession({
        session,
        mcpServers: session.mcpServers,
        features: session.features,
      });
    } catch (err) {
      console.error("Failed to restart session:", err);
      if (err instanceof SessionLifecycleBusyError) {
        toast.error(
          t(
            "sidebar.sessionOperationInProgress",
            "Another session operation is already in progress.",
          ),
        );
        return;
      }
      const lifecycleError = err instanceof RestartSessionError ? err : null;
      const cause = lifecycleError?.cause ?? err;
      const fallback =
        lifecycleError?.stage === "update"
          ? t("sidebar.failedToUpdateMcpServers", "Failed to update MCP servers")
          : t("sidebar.failedToLoadSession", "Failed to load session.");
      toast.error(extractErrorMessage(cause) || fallback);
    } finally {
      setSessionAction(null);
    }
  };

  const handleCloseSession = async (session: SessionInfo) => {
    if (sessionAction) return;
    setSessionAction({ id: session.id, type: "close" });
    try {
      await closeSession(session.id);
      if (activeSessionId === session.id) {
        handleNavigate("/");
      }
    } catch (err) {
      console.error("Failed to close session:", err);
      if (err instanceof SessionLifecycleBusyError) {
        toast.error(
          t(
            "sidebar.sessionOperationInProgress",
            "Another session operation is already in progress.",
          ),
        );
        return;
      }
      toast.error(
        extractErrorMessage(err) ||
          t("sidebar.failedToCloseSession", "Failed to close session."),
      );
    } finally {
      setSessionAction(null);
    }
  };

  const handleDeleteSession = async (session: SessionInfo) => {
    if (sessionAction) return;
    const displayTitle = session.title || t("sidebar.newSession", "New Session");
    await confirm({
      title: t("sidebar.deleteSession"),
      content: t("sidebar.deleteSessionConfirm", { title: displayTitle }),
      buttons: [
        { text: t("sidebar.cancel"), value: null, variant: "outline" },
        {
          text: t("sidebar.delete"),
          variant: "destructive",
          value: async () => {
            setSessionAction({ id: session.id, type: "delete" });
            try {
              await deleteSession(session.id);
              if (activeSessionId === session.id) {
                handleNavigate("/");
              }

              const store = useAppStore.getState();
              store.setSessions(store.sessions.filter((item) => item.id !== session.id));
              store.disposeSessionState(session.id);
              await refreshData();

              return "deleted";
            } catch (err) {
              console.error("Failed to delete session:", err);
              if (err instanceof SessionLifecycleBusyError) {
                toast.error(
                  t(
                    "sidebar.sessionOperationInProgress",
                    "Another session operation is already in progress.",
                  ),
                );
                return null;
              }
              toast.error(
                extractErrorMessage(err) || t("sidebar.failedToDeleteSession", "Failed to delete session."),
              );
              return null;
            } finally {
              setSessionAction(null);
            }
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

    if (newName) {
      await request.renameProject({ projectId: project.id, title: newName.trim() });
      await refreshData();
    }
  };

  const handleRenameSession = async (session: SessionInfo) => {
    const displayTitle = session.title || t("sidebar.newSession", "New Session");
    const newName = await prompt({
      title: t("sidebar.renameSession"),
      content: t("sidebar.enterNewSessionName"),
      defaultValue: displayTitle,
      validate: (val) =>
        val.trim() ? undefined : t("sidebar.sessionNameEmpty", "Session name cannot be empty"),
    });

    if (newName) {
      await renameSession(session.id, newName.trim());
      await refreshData();
    }
  };

  const handleDeleteProject = async (project: ProjectInfo) => {
    await confirm({
      title: t("sidebar.deleteProject"),
      content: t("sidebar.deleteProjectConfirm", { title: project.title }),
      buttons: [
        { text: t("sidebar.cancel"), value: null, variant: "outline" },
        {
          text: t("sidebar.delete"),
          value: async () => {
            const state = useAppStore.getState();
            const projectSessions = state.sessions.filter((session) => session.projectId === project.id);
            const activeSession = projectSessions.find((session) => session.id === activeSessionId);
            if (activeSession) {
              handleNavigate("/");
            }

            try {
              await deleteProject(
                project.id,
                projectSessions.map((session) => session.id),
              );

              const currentState = useAppStore.getState();
              const map = new Map(currentState.sessionStates);
              for (const session of projectSessions) map.delete(session.id);
              useAppStore.setState({ sessionStates: map });
              await refreshData();

              return "deleted";
            } catch (err) {
              console.error("Failed to delete project:", err);
              if (err instanceof SessionLifecycleBusyError) {
                toast.error(
                  t(
                    "sidebar.sessionOperationInProgress",
                    "Another session operation is already in progress.",
                  ),
                );
                return null;
              }
              toast.error(
                extractErrorMessage(err) ||
                  t("sidebar.failedToDeleteProject", "Failed to delete project."),
              );
              return null;
            }
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

  const handleOpenProjectInEditor = async (project: ProjectInfo) => {
    try {
      const editorName = useAppStore.getState().editor.name;
      await electron.openInEditor(project.cwd, editorName);
    } catch (err) {
      toast.error(
        getErrorMessage(err, t("sidebar.openInEditorFailed", "Failed to open in editor.")),
      );
    }
  };

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );

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
    <aside
      className={cn(
        "flex h-full min-h-0 w-60 flex-col border-r border-border bg-sidebar text-sidebar-foreground pointer-events-auto transition-[margin] duration-200",
        {
          "-ml-60": !sidebarOpen,
        },
      )}
    >
      <div
        className={cn(
          "transition-[height] duration-200",
          showMacTrafficLightSpace ? "h-10" : "h-0",
        )}
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
        <div
          onClick={() => handleNavigate("/automation")}
          className={`mt-0.5 group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-normal transition-colors ${
            currentPath.startsWith("/automation")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
          }`}
        >
          <ClockCheck className="size-3.5" />
          <span className="flex-1 truncate leading-normal select-none uppercase">
            {t("sidebar.automation", "Automation")}
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
          {sortedProjects.map((project) => {
            const projectSessions = sessionsByProject[project.id] ?? [];
            const expanded = isProjectExpanded(project.id);
            const currentHoverId = projectHoverId(project.id);
            // 项目最近更新时间：取项目下会话 updatedAt 的最大值；无会话时回退到项目创建时间
            const latestProjectUpdateAt =
              projectSessions.length > 0
                ? projectSessions.reduce((max, session) => Math.max(max, session.updatedAt), 0)
                : project.createdAt;
            return (
              <div key={project.id} className="space-y-0.5 group">
                <HoverCard
                  open={hoverId === currentHoverId}
                  onOpenChange={(open) => {
                    // hover 立即触发展开并跟随切换；右键菜单打开时不响应 hover；移出时关闭
                    // 关闭仅当鼠标已离开条目时生效，避免右键菜单关闭后恢复的卡片被残留事件误关（闪现）
                    if (open) {
                      if (contextMenuId === null) setHoverId(currentHoverId);
                    } else if (
                      hoverId === currentHoverId &&
                      hoveredTriggerIdRef.current !== currentHoverId
                    ) {
                      setHoverId(null);
                    }
                  }}
                >
                  <HoverCardTrigger render={<div />} delay={hoverId ? 0 : 1000}>
                    <ContextMenu
                      onOpenChange={(open) => {
                        // 右键菜单打开时隐藏所有 hoverCard，并保持条目高亮；
                        // 关闭时若鼠标仍悬停在条目上，恢复 hover 卡片
                        setContextMenuId(open ? currentHoverId : null);
                        if (open) {
                          setHoverId(null);
                        } else if (hoveredTriggerIdRef.current === currentHoverId) {
                          setHoverId(currentHoverId);
                        }
                      }}
                    >
                      <ContextMenuTrigger
                        render={
                          <div
                            onClick={() => toggleProject(project.id)}
                            onPointerEnter={() => {
                              hoveredTriggerIdRef.current = currentHoverId;
                            }}
                            onPointerLeave={() => {
                              hoveredTriggerIdRef.current = null;
                            }}
                            className={`flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs font-normal transition-colors text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/80 ${
                              hoverId === currentHoverId || contextMenuId === currentHoverId
                                ? "bg-sidebar-accent/25 text-sidebar-foreground/80"
                                : ""
                            }`}
                          />
                        }
                      >
                        {expanded ? (
                          <FolderOpen className="size-3.5" />
                        ) : (
                          <FolderClosed className="size-3.5" />
                        )}
                        <span className="flex-1 truncate leading-normal font-normal uppercase select-none">
                          {project.title}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openNewSessionDialog(project.id);
                          }}
                          className={`flex size-4 items-center justify-center rounded-sm text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70 transition-opacity duration-300 ${
                            projectSessions.length === 0
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                          aria-label={t("sidebar.createSessionInProject", {
                            defaultValue: "Create session in {{title}}",
                            title: project.title,
                          })}
                        >
                          <MessageCirclePlus className="size-3.5" />
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem onClick={() => openNewSessionDialog(project.id)}>
                          <MessageCirclePlus className="size-3" />
                          {t("sidebar.newSession", "New Session")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        {!isWebUI && (
                          <ContextMenuItem
                            onClick={() => void handleRevealProjectInFinder(project)}
                          >
                            <FolderOpen className="size-3" />
                            {t("sidebar.revealInFinder")}
                          </ContextMenuItem>
                        )}
                        {!isWebUI && (
                          <ContextMenuItem onClick={() => void handleOpenProjectInEditor(project)}>
                            <Code className="size-3" />
                            {t("filePanel.openInEditor", {
                              editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
                            })}
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem onClick={() => void handleRenameProject(project)}>
                          <Pencil className="size-3" />
                          {t("sidebar.rename")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => void handleDeleteProject(project)}
                        >
                          <Trash2 className="size-3" />
                          {t("sidebar.deleteProject")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    align="start"
                    sideOffset={12}
                    alignOffset={0}
                    className="w-54 max-w-[20vw] p-3"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-medium leading-snug line-clamp-2 wrap-break-word">
                        <span>{project.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                        <Folder className="size-3 shrink-0" />
                        {isWebUI ? (
                          <span className="truncate" title={project.cwd}>
                            {project.cwd}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleRevealProjectInFinder(project)}
                            title={project.cwd}
                            className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
                          >
                            {project.cwd}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                        <MessageCircle className="size-3 shrink-0" />
                        <span className="truncate">
                          {t("sidebar.sessionCount", "{{count}} sessions", {
                            count: projectSessions.length,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                        <Clock className="size-3 shrink-0" />
                        <span className="truncate">
                          <span className="mr-1">
                            {t(
                              projectSessions.length > 0 ? "sidebar.updated" : "sidebar.created",
                              projectSessions.length > 0 ? "Updated" : "Created",
                            )}
                            :
                          </span>
                          <span>{formatRelativeTime(latestProjectUpdateAt, i18n.language)}</span>
                        </span>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
                {expanded &&
                  projectSessions.map((session) => {
                    const currentHoverId = sessionHoverId(session.id);
                    const agentLabel =
                      configuredAgents.find((a) => a.id === session.agentId)?.id || session.agentId;
                    return (
                      <HoverCard
                        key={session.id}
                        open={hoverId === currentHoverId}
                        onOpenChange={(open) => {
                          // hover 立即触发展开并跟随切换；右键菜单打开时不响应 hover；移出时关闭
                          // 关闭仅当鼠标已离开条目时生效，避免右键菜单关闭后恢复的卡片被残留事件误关（闪现）
                          if (open) {
                            if (contextMenuId === null) setHoverId(currentHoverId);
                          } else if (
                            hoverId === currentHoverId &&
                            hoveredTriggerIdRef.current !== currentHoverId
                          ) {
                            setHoverId(null);
                          }
                        }}
                      >
                        <HoverCardTrigger render={<div />} delay={hoverId ? 0 : 1000}>
                          <ContextMenu
                            onOpenChange={(open) => {
                              // 右键菜单打开时隐藏所有 hoverCard，并保持条目高亮；
                              // 关闭时若鼠标仍悬停在条目上，恢复 hover 卡片
                              setContextMenuId(open ? currentHoverId : null);
                              if (open) {
                                setHoverId(null);
                              } else if (hoveredTriggerIdRef.current === currentHoverId) {
                                setHoverId(currentHoverId);
                              }
                            }}
                          >
                            <ContextMenuTrigger
                              render={
                                <div
                                  onClick={() => handleSelectSession(session)}
                                  onPointerEnter={() => {
                                    hoveredTriggerIdRef.current = currentHoverId;
                                  }}
                                  onPointerLeave={() => {
                                    hoveredTriggerIdRef.current = null;
                                  }}
                                  className={`group flex h-8 cursor-default items-center justify-between rounded-md pl-1.5 pr-2 text-xs font-normal transition-colors ${
                                    activeSessionId === session.id
                                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
                                  } ${
                                    hoverId === currentHoverId || contextMenuId === currentHoverId
                                      ? "bg-sidebar-accent"
                                      : ""
                                  }`}
                                />
                              }
                            >
                              <div
                                className={cn(
                                  "flex min-w-0 flex-1 items-center gap-1.5",
                                  session.connectionStatus === "connected" ? "" : "opacity-60",
                                )}
                              >
                                {(() => {
                                  const state = sessionStates.get(session.id);
                                  const hasAskUser = (state?.askUserRequests?.length ?? 0) > 0;
                                  const isStreaming = session.isStreaming;
                                  const completedStatus = state?.completedStatus;
                                  if (hasAskUser) {
                                    return <HelpCircle className="size-3 shrink-0 text-sky-500" />;
                                  }
                                  if (isStreaming) {
                                    return (
                                      <LoaderCircle className="size-3 animate-spin shrink-0" />
                                    );
                                  }
                                  if (
                                    completedStatus === "success" ||
                                    (state?.completedAt && !completedStatus)
                                  ) {
                                    return <Check className="size-3 shrink-0 text-green-500" />;
                                  }
                                  if (completedStatus === "error") {
                                    return (
                                      <TriangleAlert className="size-3 shrink-0 text-yellow-500" />
                                    );
                                  }
                                  return <div className="size-3 shrink-0" />;
                                })()}
                                <Badge
                                  variant="outline"
                                  className="px-1 -ml-0.5 text-[10px] uppercase select-none max-w-24"
                                >
                                  {agentLabel}
                                </Badge>
                                <span className="min-w-0 flex-1 truncate leading-normal select-none">
                                  {session.title || t("sidebar.newSession", "New Session")}
                                </span>
                                {activeIlinkSessionId === session.id && (
                                  <MessageCircle className="size-3 shrink-0 text-green-500" />
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-48">
                              {!isWebUI && (
                                <ContextMenuItem
                                  onClick={() => void handleRevealProjectInFinder(project)}
                                >
                                  <FolderOpen className="size-3" />
                                  {t("sidebar.revealInFinder")}
                                </ContextMenuItem>
                              )}
                              {!isWebUI && (
                                <ContextMenuItem onClick={() => void handleOpenProjectInEditor(project)}>
                                  <Code className="size-3" />
                                  {t("filePanel.openInEditor", {
                                    editor: EDITOR_LABELS[useAppStore.getState().editor.name] ?? "Editor",
                                  })}
                                </ContextMenuItem>
                              )}
                              <ContextMenuItem onClick={() => handleRenameSession(session)}>
                                <Pencil className="size-3" />
                                {t("sidebar.rename")}
                              </ContextMenuItem>
                              {ilinkStatus.connected && activeIlinkSessionId !== session.id && (
                                <ContextMenuItem
                                  onClick={() =>
                                    void handleSetActiveIlinkSession(session.id)
                                  }
                                >
                                  <MessageCircle className="size-3" />
                                  {t("sidebar.ilinkSetActive", "Set as WeChat Active")}
                                </ContextMenuItem>
                              )}
                              {ilinkStatus.connected && activeIlinkSessionId === session.id && (
                                <ContextMenuItem
                                  onClick={() =>
                                    void handleSetActiveIlinkSession("")
                                  }
                                >
                                  <MessageCircle className="size-3 text-green-500" />
                                  {t("sidebar.ilinkUnsetActive", "Unset WeChat Active")}
                                </ContextMenuItem>
                              )}
                              {session.connectionStatus === "connected" && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    onClick={() => void handleRestartSession(session)}
                                    disabled={sessionAction !== null}
                                  >
                                    {sessionAction?.id === session.id &&
                                    sessionAction.type === "restart" ? (
                                      <LoaderCircle className="size-3 animate-spin" />
                                    ) : (
                                      <RefreshCw className="size-3" />
                                    )}
                                    {t("sidebar.restartSession", "Restart Session")}
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={() => void handleCloseSession(session)}
                                    disabled={sessionAction !== null}
                                  >
                                    {sessionAction?.id === session.id &&
                                    sessionAction.type === "close" ? (
                                      <LoaderCircle className="size-3 animate-spin" />
                                    ) : (
                                      <Power className="size-3" />
                                    )}
                                    {sessionAction?.id === session.id &&
                                    sessionAction.type === "close"
                                      ? t("sidebar.closingSession", "Closing…")
                                      : t("sidebar.closeSession", "Close Session")}
                                  </ContextMenuItem>
                                </>
                              )}
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                variant="destructive"
                                onClick={() => void handleDeleteSession(session)}
                                disabled={sessionAction !== null}
                              >
                                <Trash2 className="size-3" />
                                {t("sidebar.deleteSession")}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        </HoverCardTrigger>
                        <HoverCardContent
                          side="right"
                          align="start"
                          sideOffset={12}
                          alignOffset={0}
                          className="w-54 max-w-[20vw] p-3"
                        >
                          <div className="flex flex-col gap-2">
                            <div className="text-sm font-medium leading-snug line-clamp-2 wrap-break-word">
                              <span>{session.title || t("sidebar.newSession", "New Session")}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                              <Bot className="size-3 shrink-0" />
                              <span className="truncate">{session.agentId}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                              <Folder className="size-3 shrink-0" />
                              {isWebUI ? (
                                <span className="truncate">{project.title}</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleRevealProjectInFinder(project)}
                                  title={project.cwd}
                                  className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
                                >
                                  {project.title}
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                              <Clock className="size-3 shrink-0" />
                              <span className="truncate">
                                <span className="mr-1">{t("sidebar.updated", "Updated")}:</span>
                                <span>{formatRelativeTime(session.updatedAt, i18n.language)}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                              <CalendarDays className="size-3 shrink-0" />
                              <span className="truncate">
                                <span className="mr-1">{t("sidebar.created", "Created")}:</span>
                                <span>{formatRelativeTime(session.createdAt, i18n.language)}</span>
                              </span>
                            </div>
                            {ilinkStatus.connected && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                                <MessageCircle
                                  className={cn(
                                    "size-3 shrink-0",
                                    activeIlinkSessionId === session.id && "text-green-500",
                                  )}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSetActiveIlinkSession(
                                      activeIlinkSessionId === session.id ? "" : session.id,
                                    )
                                  }
                                  className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
                                >
                                  {t(
                                    activeIlinkSessionId === session.id
                                      ? "sidebar.ilinkActiveStatus"
                                      : "sidebar.ilinkInactiveStatus",
                                    activeIlinkSessionId === session.id
                                      ? "WeChat Active"
                                      : "Not WeChat Active",
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })}
              </div>
            );
          })}
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
            <span>{t("sidebar.settings")}</span>
            {process.env.NODE_ENV === "development" && (
              <span className="text-xs text-indigo-400/80 -ml-1.5 inline-block scale-50 origin-left -translate-y-1">
                [DEV]
              </span>
            )}
          </div>
          {webUIStatus.enabled && (
            <div title={t("sidebar.webuiEnabled", "WebUI Enabled")}>
              <Globe className="size-3 text-green-500" />
            </div>
          )}
        </Button>
      </div>

      <Dialog open={newSessionDialogOpen} onOpenChange={setNewSessionDialogOpen}>
        <DialogContent className="max-w-lg!">
          <DialogHeader>
            <DialogTitle>
              {t("sidebar.newSessionDialog.title", { defaultValue: "Create session" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-row gap-2">
              <div className="flex-2 flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {t("sidebar.newSessionDialog.agent", { defaultValue: "Agent" })}
                </div>
                {enabledAgents.length > 1 && enabledAgents.length <= 3 ? (
                  <Tabs
                    value={newSessionAgentId}
                    onValueChange={(v) => setNewSessionAgentId(v as string)}
                  >
                    <TabsList className="w-full h-7! border rounded-md">
                      {enabledAgents.map((agent) => (
                        <TabsTrigger
                          key={agent.id}
                          value={agent.id}
                          className="text-xs h-5 uppercase rounded-sm"
                        >
                          {agent.id}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : (
                  <Select
                    value={newSessionAgentId}
                    onValueChange={(v) => {
                      if (typeof v === "string") setNewSessionAgentId(v);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue
                        placeholder={t("sidebar.newSessionDialog.selectAgent", {
                          defaultValue: "Select an agent",
                        })}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {t("sidebar.newSessionDialog.permission", { defaultValue: "Permission" })}
                </div>
                {(() => {
                  const permissionItems = [
                    {
                      value: "ask",
                      label: t("sidebar.newSessionDialog.permissionAsk", { defaultValue: "Ask" }),
                    },
                    {
                      value: "allow-all",
                      label: t("sidebar.newSessionDialog.permissionAllowAll", {
                        defaultValue: "Allow all",
                      }),
                    },
                  ];
                  return (
                    <Select
                      items={permissionItems}
                      value={newSessionPermissionMode}
                      onValueChange={(v) => {
                        if (v === "ask" || v === "allow-all") setNewSessionPermissionMode(v);
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {permissionItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">
                {t("constant.feature.title", { defaultValue: "Features" })}
              </div>
              <div
                className={
                  ALL_FEATURES.length >= 2 ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1"
                }
              >
                {ALL_FEATURES.map((feature) => (
                  <div
                    key={feature}
                    className="flex items-center justify-between rounded border bg-secondary/50 px-2 h-7 cursor-default hover:bg-accent transition-colors"
                    onClick={() =>
                      setNewSessionFeatures((prev) =>
                        prev.includes(feature)
                          ? prev.filter((f) => f !== feature)
                          : [...prev, feature],
                      )
                    }
                  >
                    <div
                      className={cn(
                        "text-xs truncate",
                        !newSessionFeatures.includes(feature)
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground",
                      )}
                    >
                      {t(FEATURE_I18N_KEYS[feature], { defaultValue: feature })}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        size="sm"
                        checked={newSessionFeatures.includes(feature)}
                        onCheckedChange={(checked) => {
                          setNewSessionFeatures((prev) =>
                            checked ? [...prev, feature] : prev.filter((f) => f !== feature),
                          );
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted-foreground">
                {t("sidebar.newSessionDialog.mcp", { defaultValue: "MCP" })}
              </div>
              <div
                className={
                  configuredMcpServers.length >= 2
                    ? "grid grid-cols-2 gap-1"
                    : "flex flex-col gap-1"
                }
              >
                {configuredMcpServers.map((mcp) => (
                  <div
                    key={mcp.id}
                    className="flex items-center justify-between rounded border bg-secondary/50 px-2 h-7 cursor-default hover:bg-accent transition-colors"
                    onClick={() => {
                      setNewSessionMcpIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(mcp.id)) next.delete(mcp.id);
                        else next.add(mcp.id);
                        return next;
                      });
                    }}
                  >
                    <div
                      className={cn(
                        "text-xs truncate",
                        !newSessionMcpIds.has(mcp.id)
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground",
                      )}
                      title={mcp.id}
                    >
                      {mcp.id}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        size="sm"
                        checked={newSessionMcpIds.has(mcp.id)}
                        onCheckedChange={(checked) => {
                          setNewSessionMcpIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(mcp.id);
                            else next.delete(mcp.id);
                            return next;
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
                {configuredMcpServers.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {t("sidebar.newSessionDialog.noMcp", {
                      defaultValue: "No MCP servers configured",
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="h-8 text-xs"
              variant="outline"
              onClick={() => setNewSessionDialogOpen(false)}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              variant="default"
              disabled={creating}
              onClick={handleCreateNewSession}
            >
              {creating && <LoaderCircle className="size-3 animate-spin" />}
              {t("sidebar.newSessionDialog.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
