import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  CalendarDays,
  Clock,
  Code,
  Copy,
  Eye,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MessageCircle,
  MessageCirclePlus,
  Pencil,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ProjectInfo, SessionInfo, SettingsInfo } from "../../../shared/schema";
import { EDITOR_LABELS } from "../../../shared/constants";
import { resolveSessionTitle } from "../../../shared/session-title";
import { isWebUI, request } from "../../backend";
import { electron } from "../../electron";
import { useAppStore } from "../../store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, extractErrorMessage } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMessage } from "../providers/message";
import {
  closeSession,
  deleteProject,
  deleteSession,
  restartSession,
  RestartSessionError,
  SessionLifecycleBusyError,
} from "../../lib/session-lifecycle";
import { SessionRowStatus } from "./row-status";
import {
  projectHoverId,
  sessionHoverId,
  sidebarNavigationItemKey,
  TREE_NODES_TYPE,
} from "./sidebar-constants";
import type { SidebarHoverState, SidebarNavigationBinding } from "./sidebar-types";
import { formatRelativeTime, getErrorMessage } from "./sidebar-utils";

export type ProjectTreeProps = {
  /** 已按标题排序的项目列表 */
  projects: ProjectInfo[];
  sessionsByProject: Record<string, SessionInfo[]>;
  configuredAgents: SettingsInfo["agents"];
  activeSessionId: string | null;
  activeIlinkSessionId: string | null;
  ilinkConnected: boolean;
  isProjectExpanded: (projectId: string) => boolean;
  onToggleProject: (projectId: string) => void;
  onExpandProject: (projectId: string) => void;
  refreshData: () => Promise<void>;
  onOpenNewSession: (projectId: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onRenameSession: (session: SessionInfo) => void;
  onSetActiveIlinkSession: (sessionId: string) => void;
  onNavigate: (path: string) => void;
  onAddProject: () => void;
  hover: SidebarHoverState;
  navigation: SidebarNavigationBinding;
};

/**
 * 项目与会话列表。
 *
 * 整体同时作为「拖入文件夹添加项目」的落点；项目 / 会话的右键菜单与 hover 卡片都收在这里，
 * 侧边栏只保留键盘导航和跨分区的共享状态。
 */
export function ProjectTree({
  projects,
  sessionsByProject,
  configuredAgents,
  activeSessionId,
  activeIlinkSessionId,
  ilinkConnected,
  isProjectExpanded,
  onToggleProject,
  onExpandProject,
  refreshData,
  onOpenNewSession,
  onSelectSession,
  onRenameSession,
  onSetActiveIlinkSession,
  onNavigate,
  onAddProject,
  hover,
  navigation,
}: ProjectTreeProps) {
  const { t, i18n } = useTranslation();
  const { prompt, confirm, toast } = useMessage();
  const { hoverId, setHoverId, contextMenuId, setContextMenuId, hoveredTriggerIdRef } = hover;
  const { itemRefs, listRef, addProjectButtonRef, onItemKeyDown, onAddProjectKeyDown } = navigation;

  const [projectDropActive, setProjectDropActive] = useState(false);
  const projectDragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionAction, setSessionAction] = useState<{
    id: string;
    type: "restart" | "close" | "delete";
  } | null>(null);

  useEffect(
    () => () => {
      if (projectDragLeaveTimer.current) clearTimeout(projectDragLeaveTimer.current);
    },
    [],
  );

  /**
   * 从拖拽载荷提取路径：优先 `electron.getPathForFile`（桌面端 File），
   * 取不到时回退解析 `text/uri-list` 的 file:// URI（覆盖 VS Code 文件树等外部来源）。
   */
  const extractDropPaths = (dataTransfer: DataTransfer): string[] => {
    const paths: string[] = [];
    for (const file of Array.from(dataTransfer.files ?? [])) {
      const absPath = electron.getPathForFile(file);
      if (absPath) paths.push(absPath);
    }
    if (paths.length > 0) return paths;
    const uriList = dataTransfer.getData("text/uri-list");
    return (uriList ? uriList.split("\n") : [])
      .map((uri) => uri.trim())
      .filter((uri) => uri.startsWith("file://"))
      .map((uri) => decodeURIComponent(uri.replace(/^file:\/\//, "")))
      .filter(Boolean);
  };

  const handleProjectDropDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    // WebUI 下拖入的是客户端本地路径，对服务端无意义，不接受
    if (isWebUI) return;
    const types = event.dataTransfer.types;
    // file-panel 文件树的内部拖拽（含文件时会带 text/uri-list）不参与「拖入添加项目」
    if (types.includes(TREE_NODES_TYPE)) return;
    if (!types.includes("Files") && !types.includes("text/uri-list")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    // 子元素间切换会先 leave 再 enter，取消挂起的防抖避免高亮闪烁
    if (projectDragLeaveTimer.current) {
      clearTimeout(projectDragLeaveTimer.current);
      projectDragLeaveTimer.current = null;
    }
    setProjectDropActive(true);
  };

  const handleProjectDropDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    // 50ms 防抖（与 ask-user / FilePanel 一致），行与行之间滑动不闪烁；
    // 先取消旧 timer 再设置，防止旧 timer 在指针已回到落点内（且静止无新 dragover）时误清高亮
    if (projectDragLeaveTimer.current) clearTimeout(projectDragLeaveTimer.current);
    projectDragLeaveTimer.current = setTimeout(() => setProjectDropActive(false), 50);
  };

  const handleProjectDropDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (projectDragLeaveTimer.current) {
      clearTimeout(projectDragLeaveTimer.current);
      projectDragLeaveTimer.current = null;
    }
    setProjectDropActive(false);

    // file-panel 文件树的内部拖拽：不是系统文件，忽略
    if (event.dataTransfer.getData(TREE_NODES_TYPE)) return;
    if (isWebUI) return;

    const paths = [...new Set(extractDropPaths(event.dataTransfer))];
    if (paths.length === 0) return;

    // 与「添加项目」按钮同一流程：逐个添加（按 cwd 幂等；cwd 必须是目录，由后端 addProject 统一校验）
    const added: ProjectInfo[] = [];
    let failedCount = 0;
    for (const path of paths) {
      try {
        added.push(await request.addProject(path));
      } catch (err) {
        failedCount += 1;
        console.error("Failed to add dropped path as project:", err);
      }
    }
    if (failedCount > 0) {
      // 拖放场景下的预期失败即「拖入的不是文件夹 / 路径不存在」
      toast.error(t("sidebar.dropFolderOnly", "Only folders can be dropped to add a project."));
    }
    if (added.length === 0) return;
    try {
      await refreshData();
      for (const project of added) onExpandProject(project.id);
      // 单个时自动弹创建会话框（与按钮行为一致）
      if (added.length === 1) onOpenNewSession(added[0].id);
    } catch (err) {
      toast.error(getErrorMessage(err, t("sidebar.addProjectFailed", "Failed to add project.")));
    }
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
        onNavigate("/");
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
        extractErrorMessage(err) || t("sidebar.failedToCloseSession", "Failed to close session."),
      );
    } finally {
      setSessionAction(null);
    }
  };

  const handleDeleteSession = async (session: SessionInfo) => {
    if (sessionAction) return;
    const displayTitle = resolveSessionTitle(session) || t("sidebar.newSession", "New Session");
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
                onNavigate("/");
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
                extractErrorMessage(err) ||
                  t("sidebar.failedToDeleteSession", "Failed to delete session."),
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
            const projectSessions = state.sessions.filter(
              (session) => session.projectId === project.id,
            );
            const activeSession = projectSessions.find((session) => session.id === activeSessionId);
            if (activeSession) {
              onNavigate("/");
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

  /**
   * 复制项目根目录的绝对路径。
   *
   * 与「在访达中显示」/「在编辑器中打开」同源（都用 `project.cwd`），保证复制到的就是界面展示的那条路径；
   * 项目本身没有相对路径概念，因此不提供「复制相对路径」。WebUI 下同样可用（纯文本复制，不依赖本机文件系统）。
   */
  const handleCopyProjectPath = async (project: ProjectInfo) => {
    await copyText(project.cwd);
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={handleProjectDropDragOver}
      onDragLeave={handleProjectDropDragLeave}
      onDrop={(event) => void handleProjectDropDrop(event)}
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-xs font-normal tracking-wide text-sidebar-foreground/40 uppercase select-none">
          {t("sidebar.projects")}
        </span>
        <Button
          ref={addProjectButtonRef}
          variant="ghost"
          size="icon"
          tabIndex={-1}
          className="size-6 -mr-1 text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70"
          onClick={onAddProject}
          onKeyDown={onAddProjectKeyDown}
          aria-label={t("sidebar.addProject", "Add project")}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={listRef}
          role="tree"
          aria-label={t("sidebar.sessions", "Sessions")}
          className="p-1.5 outline-none focus:ring-1 focus:ring-ring/50"
        >
          {projects.map((project) => {
            const projectSessions = sessionsByProject[project.id] ?? [];
            const expanded = isProjectExpanded(project.id);
            const currentHoverId = projectHoverId(project.id);
            // 项目最近更新时间：取项目下会话 updatedAt 的最大值；无会话时回退到项目创建时间
            const latestProjectUpdateAt =
              projectSessions.length > 0
                ? projectSessions.reduce((max, session) => Math.max(max, session.updatedAt), 0)
                : project.createdAt;
            // 项目标题只跟随「已连接」加深；微信活跃不参与，避免与会话行的高亮语义混淆。
            const hasConnectedSession = projectSessions.some(
              (session) => session.connectionStatus === "connected",
            );

            return (
              <div key={project.id} className="group">
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
                  <HoverCardTrigger render={<div />} delay={0} closeDelay={100}>
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
                            ref={(element) => {
                              const key = sidebarNavigationItemKey({
                                type: "project",
                                id: project.id,
                              });
                              if (element) {
                                itemRefs.current.set(key, element);
                              } else {
                                itemRefs.current.delete(key);
                              }
                            }}
                            tabIndex={-1}
                            role="treeitem"
                            aria-level={1}
                            aria-expanded={expanded}
                            onClick={() => onToggleProject(project.id)}
                            onKeyDown={(event) =>
                              onItemKeyDown(event, {
                                type: "project",
                                id: project.id,
                              })
                            }
                            onPointerEnter={() => {
                              hoveredTriggerIdRef.current = currentHoverId;
                            }}
                            onPointerLeave={() => {
                              hoveredTriggerIdRef.current = null;
                            }}
                            className={cn(
                              "flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs font-normal transition-colors text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground/95 outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                              hoverId === currentHoverId || contextMenuId === currentHoverId
                                ? "bg-sidebar-accent"
                                : "",
                            )}
                          />
                        }
                      >
                        {expanded ? (
                          <FolderOpen className="size-3.5" />
                        ) : (
                          <FolderClosed className="size-3.5" />
                        )}
                        <span
                          className={cn(
                            "flex-1 truncate leading-normal font-normal select-none",
                            hasConnectedSession ? "text-sidebar-foreground/90" : "",
                          )}
                        >
                          {project.title}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenNewSession(project.id);
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
                        <ContextMenuItem
                          onClick={() => onOpenNewSession(project.id)}
                          className="font-medium text-foreground"
                        >
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
                        <ContextMenuItem onClick={() => void handleCopyProjectPath(project)}>
                          <Copy className="size-3" />
                          {t("sidebar.copyProjectPath")}
                        </ContextMenuItem>
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
                    className="w-54 p-3"
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
                {/* 0fr → 1fr 的 grid 过渡：高度自适应内容，不需要测量，展开/收起都能过渡。 */}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                  inert={!expanded}
                >
                  <div className="min-h-0 overflow-hidden">
                    {projectSessions.map((session) => {
                      const currentHoverId = sessionHoverId(session.id);
                      const agentLabel =
                        configuredAgents.find((a) => a.id === session.agentId)?.id ||
                        session.agentId;
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
                          <HoverCardTrigger
                            render={<div className="my-0.5" />}
                            delay={0}
                            closeDelay={100}
                          >
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
                                    ref={(element) => {
                                      const key = sidebarNavigationItemKey({
                                        type: "session",
                                        id: session.id,
                                        projectId: project.id,
                                      });
                                      if (element) {
                                        itemRefs.current.set(key, element);
                                      } else {
                                        itemRefs.current.delete(key);
                                      }
                                    }}
                                    tabIndex={-1}
                                    role="treeitem"
                                    aria-level={2}
                                    aria-current={
                                      activeSessionId === session.id ? "page" : undefined
                                    }
                                    onClick={() => onSelectSession(session)}
                                    onKeyDown={(event) =>
                                      onItemKeyDown(event, {
                                        type: "session",
                                        id: session.id,
                                        projectId: project.id,
                                      })
                                    }
                                    onPointerEnter={() => {
                                      hoveredTriggerIdRef.current = currentHoverId;
                                    }}
                                    onPointerLeave={() => {
                                      hoveredTriggerIdRef.current = null;
                                    }}
                                    className={`group flex h-7 cursor-default items-center justify-between rounded-md pl-1.5 pr-2 text-xs transition-colors outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring ${
                                      activeSessionId === session.id
                                        ? "font-medium bg-sidebar-accent text-sidebar-accent-foreground"
                                        : session.connectionStatus === "connected"
                                          ? "text-sidebar-foreground/90 hover:bg-sidebar-accent"
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
                                  <SessionRowStatus
                                    sessionId={session.id}
                                    isStreaming={session.isStreaming}
                                  />
                                  <Badge
                                    variant="outline"
                                    className="px-1 -ml-0.5 text-[9px] uppercase select-none max-w-24"
                                  >
                                    {agentLabel}
                                  </Badge>
                                  <span className="min-w-0 flex-1 truncate leading-normal select-none">
                                    {resolveSessionTitle(session) ||
                                      t("sidebar.newSession", "New Session")}
                                  </span>
                                  {activeIlinkSessionId === session.id && (
                                    <MessageCircle className="size-3 shrink-0 text-green-500" />
                                  )}
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-48">
                                <ContextMenuItem
                                  onClick={() => onSelectSession(session)}
                                  className="font-medium text-foreground"
                                >
                                  <Eye className="size-3" />
                                  {t("sidebar.viewSession", "View Session")}
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
                                  <ContextMenuItem
                                    onClick={() => void handleOpenProjectInEditor(project)}
                                  >
                                    <Code className="size-3" />
                                    {t("filePanel.openInEditor", {
                                      editor:
                                        EDITOR_LABELS[useAppStore.getState().editor.name] ??
                                        "Editor",
                                    })}
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem
                                  onClick={() => void handleCopyProjectPath(project)}
                                >
                                  <Copy className="size-3" />
                                  {t("sidebar.copyProjectPath")}
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => onRenameSession(session)}>
                                  <Pencil className="size-3" />
                                  {t("sidebar.rename")}
                                </ContextMenuItem>
                                {ilinkConnected && activeIlinkSessionId !== session.id && (
                                  <ContextMenuItem
                                    onClick={() => void onSetActiveIlinkSession(session.id)}
                                  >
                                    <MessageCircle className="size-3" />
                                    {t("sidebar.ilinkSetActive", "Set as WeChat Active")}
                                  </ContextMenuItem>
                                )}
                                {ilinkConnected && activeIlinkSessionId === session.id && (
                                  <ContextMenuItem onClick={() => void onSetActiveIlinkSession("")}>
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
                            className="w-54 p-3"
                          >
                            <div className="flex flex-col gap-2">
                              <div className="text-sm font-medium leading-snug line-clamp-2 wrap-break-word">
                                <span>
                                  {resolveSessionTitle(session) ||
                                    t("sidebar.newSession", "New Session")}
                                </span>
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
                                  <span>
                                    {formatRelativeTime(session.updatedAt, i18n.language)}
                                  </span>
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground py-px">
                                <CalendarDays className="size-3 shrink-0" />
                                <span className="truncate">
                                  <span className="mr-1">{t("sidebar.created", "Created")}:</span>
                                  <span>
                                    {formatRelativeTime(session.createdAt, i18n.language)}
                                  </span>
                                </span>
                              </div>
                              {ilinkConnected && (
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
                                      void onSetActiveIlinkSession(
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
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      {projectDropActive && (
        // 与 FilePanel 项目根落点同款的整块高亮（不参与布局）
        <div className="pointer-events-none absolute inset-x-1 inset-y-1 rounded-md bg-primary/5 inset-ring-1 inset-ring-primary" />
      )}
    </div>
  );
}
