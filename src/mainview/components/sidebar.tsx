import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type ProjectInfo, type SessionInfo } from "../store";
import { request } from "../backend";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsAgentsDialog } from "./settings-agents-dialog";
import { SettingsWebUIDialog } from "./settings-webui-dialog";
import { useMessage } from "./message";
import {
  FolderOpen,
  FolderClosed,
  MessageCirclePlus,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Settings,
  Sun,
  Moon,
  Monitor,
  Bot,
  Palette,
  LoaderCircle,
  Home,
  Globe,
} from "lucide-react";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Failed to create a new chat.";
}

import { isWebUI } from "../backend";

export function Sidebar() {
  const { t, i18n } = useTranslation();
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
    configuredAgents,
    theme,
    setTheme,
    language,
    setLanguage,
    sessionStates,
    webUIStatus,
  } = useAppStore();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [openAgentMenuProjectId, setOpenAgentMenuProjectId] = useState<string | null>(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webUIOpen, setWebUIOpen] = useState(false);
  const { prompt, confirm } = useMessage();

  if (!sidebarOpen) return null;

  const applySessionState = (
    payload: {
      models: { availableModels: any[]; currentModelId: string } | null;
      modes: { availableModes: any[]; currentModeId: string } | null;
    } | null,
  ) => {
    if (!payload) return;
    if (payload.models) {
      useAppStore.getState().setAvailableModels(payload.models.availableModels);
      useAppStore.getState().setCurrentModelId(payload.models.currentModelId);
    } else {
      useAppStore.getState().setAvailableModels([]);
      useAppStore.getState().setCurrentModelId(null);
    }
    if (payload.modes) {
      useAppStore.getState().setAvailableModes(payload.modes.availableModes);
      useAppStore.getState().setCurrentModeId(payload.modes.currentModeId);
    } else {
      useAppStore.getState().setAvailableModes([]);
      useAppStore.getState().setCurrentModeId(null);
    }
  };

  const refreshData = async () => {
    const [nextProjects, nextSessions] = await Promise.all([
      request.listProjects(),
      request.listSessions(),
    ]);
    setProjects(nextProjects ?? []);
    setSessions(nextSessions ?? []);
    return {
      projects: (nextProjects as ProjectInfo[]) ?? [],
      sessions: (nextSessions as SessionInfo[]) ?? [],
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
        const p = await request.showOpenDialog();
        if (!p) return;
        selectedPath = p;
      }

      const result = (await request.addProject(selectedPath)) as {
        project: ProjectInfo;
        created: boolean;
      };
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

  const handleNewChat = async (projectId: string, agentId: string) => {
    try {
      setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
      setIsConnecting(true);
      const result = (await request.newSession({ projectId, agentId })) as {
        sessionId: string;
        models: { availableModels: any[]; currentModelId: string } | null;
        modes: { availableModes: any[]; currentModeId: string } | null;
      } | null;
      if (!result) return;
      setActiveSessionId(result.sessionId);
      applySessionState(result);
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
        modes: { availableModes: any[]; currentModeId: string } | null;
      } | null;
      if (!result) return;
      applySessionState(result);
    } catch (err) {
      console.error("Failed to load session:", err);
      pushGlobalErrorMessage(getErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeleteSession = async (session: SessionInfo) => {
    await confirm({
      title: t("sidebar.deleteChat"),
      content: t("sidebar.deleteChatConfirm", { title: session.title }),
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
              const next = updated.length > 0 ? updated[0].id : null;
              setActiveSessionId(next);
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
      validate: (val) => (val.trim() ? undefined : "Project name cannot be empty"),
    });

    if (newName && newName !== "cancel") {
      await request.renameProject({ projectId: project.id, title: newName.trim() });
      await refreshData();
    }
  };

  const handleRenameSession = async (session: SessionInfo) => {
    const newName = await prompt({
      title: t("sidebar.renameChat"),
      content: t("sidebar.enterNewChatName"),
      defaultValue: session.title,
      validate: (val) => (val.trim() ? undefined : "Chat name cannot be empty"),
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
              setActiveSessionId(updated.length > 0 ? updated[0].id : null);
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
      await request.revealInFinder(project.cwd);
    } catch (err) {
      pushGlobalErrorMessage(getErrorMessage(err));
    }
  };

  const handleThemeChange = async (mode: "light" | "dark" | "system") => {
    const newTheme = { theme_mode: mode };
    setTheme(newTheme);
    try {
      await request.updateSettings({
        agents: configuredAgents,
        theme: newTheme,
        language,
      });
    } catch {
      pushGlobalErrorMessage("Failed to save theme setting.");
    }
  };

  const handleLanguageChange = async (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    try {
      await request.updateSettings({
        agents: configuredAgents,
        theme,
        language: lang,
      });
    } catch {
      pushGlobalErrorMessage("Failed to save language setting.");
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
    <aside className="flex h-full min-h-0 w-60 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <div className="px-2 pt-2 pb-1">
        <div
          onClick={() => setActiveSessionId(null)}
          className={`group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-xs font-medium transition-colors ${
            !activeSessionId
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
          }`}
        >
          <Home className="size-3.5" />
          <span className="flex-1 truncate leading-normal">{t("sidebar.welcome")}</span>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-2 pt-2">
        <span className="text-[10px] font-medium tracking-wide text-sidebar-foreground/35 uppercase">
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
                  className={`group flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-sidebar-foreground/45 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/80 ${
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
                  <span
                    className="flex-1 truncate leading-normal font-normal uppercase"
                    title={project.cwd}
                  >
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
                      {!isWebUI && (
                        <DropdownMenuItem
                          className="text-xs rounded-1 text-muted-foreground/90"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRevealProjectInFinder(project);
                          }}
                        >
                          <FolderOpen className="size-3" />
                          {t("sidebar.revealInFinder")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-xs rounded-1 text-muted-foreground/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameProject(project);
                        }}
                      >
                        <Pencil className="size-3" />
                        {t("sidebar.rename")}
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
                        {t("sidebar.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {configuredAgents.length > 1 ? (
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
                        {configuredAgents.map((agent) => (
                          <DropdownMenuItem
                            key={agent.id}
                            className="text-xs rounded-1 text-muted-foreground/90"
                            onClick={() => {
                              void handleNewChat(project.id, agent.id);
                            }}
                          >
                            {agent.id}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (configuredAgents.length === 1) {
                          void handleNewChat(project.id, configuredAgents[0].id);
                        } else {
                          setSettingsOpen(true);
                        }
                      }}
                      className="flex size-4 items-center justify-center rounded-sm transition-opacity opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:bg-sidebar-accent/25 hover:text-sidebar-foreground/70"
                      aria-label={`Create chat in ${project.title}`}
                    >
                      <MessageCirclePlus className="size-3" />
                    </button>
                  )}
                </div>
                {expanded &&
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session)}
                      className={`group flex h-8 cursor-default items-center justify-between rounded-md px-2 text-xs font-medium transition-colors ${
                        activeSessionId === session.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/95"
                      } ${openSessionMenuId === session.id ? "bg-sidebar-accent" : ""}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <LoaderCircle
                          className={cn(
                            "size-3 animate-spin",
                            !sessionStates.get(session.id)?.isStreaming && "invisible",
                          )}
                        />
                        <Badge
                          variant="outline"
                          className="px-1 -ml-1 text-[10px] uppercase max-w-15 truncate text-center leading-normal py-0"
                        >
                          {configuredAgents.find((a) => a.id === session.agentId)?.id ||
                            session.agentId}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate leading-normal">
                          {session.title}
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
                            {t("sidebar.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            className="text-xs rounded-1 text-muted-foreground/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSession(session);
                            }}
                          >
                            <Trash2 className="size-3" />
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
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {t("sidebar.noProjects")}
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="mt-auto border-t border-border/60 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "flex w-full items-center justify-between gap-2 rounded-md p-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/90 outline-none",
            )}
          >
            <div className="flex items-center gap-2">
              <Settings className="size-4" />
              {t("sidebar.settings")}
            </div>
            {webUIStatus.enabled && (
              <div title={t("sidebar.webuiEnabled", "WebUI Enabled")}>
                <Globe className="size-3 text-green-500" />
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="py-1">
            {!isWebUI && (
              <>
                <DropdownMenuItem
                  className="text-xs rounded-1 text-muted-foreground/90"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Bot className="size-3" />
                  {t("sidebar.agents")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs rounded-1 text-muted-foreground/90"
                  onClick={() => setWebUIOpen(true)}
                >
                  <Globe className={cn("size-3", { "text-green-500": webUIStatus.enabled })} />
                  WebUI
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isWebUI && (
              <>
                <DropdownMenuItem
                  className="text-xs rounded-1 text-muted-foreground/90"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Bot className="size-3" />
                  {t("sidebar.agents")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-xs rounded-1 text-muted-foreground/90">
                <Palette className="size-3" />
                {t("sidebar.theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-32 py-1">
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={() => void handleThemeChange("light")}
                  >
                    <Sun className="size-3" />
                    {t("sidebar.light")}
                    {theme.theme_mode === "light" && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={() => void handleThemeChange("dark")}
                  >
                    <Moon className="size-3" />
                    {t("sidebar.dark")}
                    {theme.theme_mode === "dark" && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={() => void handleThemeChange("system")}
                  >
                    <Monitor className="size-3" />
                    {t("sidebar.system")}
                    {theme.theme_mode === "system" && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-xs rounded-1 text-muted-foreground/90">
                <Globe className="size-3" />
                {t("sidebar.language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-32 py-1">
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={() => void handleLanguageChange("en")}
                  >
                    {t("sidebar.english")}
                    {language === "en" && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={() => void handleLanguageChange("zh-CN")}
                  >
                    {t("sidebar.chinese")}
                    {language === "zh-CN" && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SettingsAgentsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SettingsWebUIDialog open={webUIOpen} onOpenChange={setWebUIOpen} />
    </aside>
  );
}
