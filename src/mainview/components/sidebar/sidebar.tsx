import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../../store";
import type { AssistantConfig, SessionInfo } from "../../../shared/schema";
import { isWebUI, request } from "../../backend";
import { electron } from "../../electron";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Globe, Settings } from "lucide-react";
import { useMessage } from "../providers/message";
import { isContextMenuKey, openContextMenuFromKeyboard, useFocusTarget } from "../../lib/keyboard";
import { renameSession } from "../../lib/session-lifecycle";
import { RenameSessionDialog } from "./rename-session-dialog";
import { UpdateCard } from "./update-card";
import { SidebarNav } from "./sidebar-nav";
import { AssistantSection } from "./assistant-section";
import { ProjectTree } from "./project-tree";
import { NewSessionDialog, type NewSessionDialogHandle } from "./new-session-dialog";
import { NewAssistantDialog, type NewAssistantDialogHandle } from "./new-assistant-dialog";
import { sidebarNavigationItemKey, type SidebarNavigationItem } from "./sidebar-constants";
import type { SidebarHoverState, SidebarNavigationBinding } from "./sidebar-types";
import { getErrorMessage } from "./sidebar-utils";

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setOptimisticPath(null);
  }, [location.pathname]);

  const newSessionDialogRef = useRef<NewSessionDialogHandle>(null);
  const newAssistantDialogRef = useRef<NewAssistantDialogHandle>(null);

  const handleAddProjectRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const handler = () => handleAddProjectRef.current?.();
    window.addEventListener("fello:add-project", handler);
    return () => window.removeEventListener("fello:add-project", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const projectId = (e as CustomEvent).detail?.projectId;
      if (projectId) newSessionDialogRef.current?.open(projectId);
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
  const matchAssistant = currentPath.match(/^\/assistant\/([^/?#]+)/);
  const activeAssistantId = matchAssistant ? decodeURIComponent(matchAssistant[1]) : null;

  // 逐项按需订阅，避免用无 selector 的 useAppStore() 全量订阅整个 store：
  // 流式期间每个 token 都会写入 sessionStates，全量订阅会让整个侧边栏每帧重渲染。
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const projects = useAppStore((s) => s.projects);
  const sessions = useAppStore((s) => s.sessions);
  const setProjects = useAppStore((s) => s.setProjects);
  const setSessions = useAppStore((s) => s.setSessions);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const configuredAgents = useAppStore((s) => s.configuredAgents);
  const webUIStatus = useAppStore((s) => s.webUIStatus);
  const ilinkStatus = useAppStore((s) => s.ilinkStatus);
  const activeIlinkSessionId = useAppStore((s) => s.activeIlinkSessionId);
  // 只订阅列表本身；设置页只在全局开关 / workerTypes 变更时更新 assistant。
  const assistants = useAppStore((s) => s.assistants);
  // 关闭个人助理时整个分区隐藏（设置在设置页切换后立即生效）
  const assistantEnabled = useAppStore((s) => s.assistant.enabled);
  // 只订阅当前会话的 completedAt（原始值），不订阅整个 sessionStates
  const activeCompletedAt = useAppStore((s) =>
    activeSessionId ? (s.sessionStates.get(activeSessionId)?.completedAt ?? null) : null,
  );

  // Auto-clear completedAt after 3 seconds for the active session
  const completedAtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (!sessions.some((s) => s.id === activeSessionId)) return; // Session deleted
    if (!activeCompletedAt) return;

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

    return () => {
      if (completedAtTimerRef.current) {
        clearTimeout(completedAtTimerRef.current);
        completedAtTimerRef.current = null;
      }
    };
  }, [activeSessionId, activeCompletedAt, sessions]);

  // Same as sessions: clear a finished state after 3s while its page is open.
  const activeAssistantCompletedAt = useAppStore((s) =>
    activeAssistantId ? (s.sessionStates.get(activeAssistantId)?.completedAt ?? null) : null,
  );
  const assistantCompletedAtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeAssistantId || !activeAssistantCompletedAt) return;

    if (assistantCompletedAtTimerRef.current) {
      clearTimeout(assistantCompletedAtTimerRef.current);
    }
    assistantCompletedAtTimerRef.current = setTimeout(() => {
      useAppStore.getState().updateSessionState(activeAssistantId, () => ({
        completedAt: null,
        completedStatus: null,
      }));
      assistantCompletedAtTimerRef.current = null;
    }, 3000);

    return () => {
      if (assistantCompletedAtTimerRef.current) {
        clearTimeout(assistantCompletedAtTimerRef.current);
        assistantCompletedAtTimerRef.current = null;
      }
    };
  }, [activeAssistantId, activeAssistantCompletedAt]);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  // 重命名会话弹层：目标会话 + 受控输入值（没有用户标题时为空串）。
  const [renameTarget, setRenameTarget] = useState<SessionInfo | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  // 记录鼠标当前悬停的条目（用于右键菜单关闭后恢复 hover 卡片，避免出现后立即消失的闪现）
  const hoveredTriggerIdRef = useRef<string | null>(null);

  const { prompt, toast } = useMessage();

  const openNewSessionDialog = (projectId: string) => {
    newSessionDialogRef.current?.open(projectId);
  };
  const openNewAssistantDialog = () => {
    newAssistantDialogRef.current?.open();
  };
  const handleNeedAgent = () => handleNavigate("/settings/agents");

  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  const refreshData = async () => {
    const [nextProjects, nextSessions] = await Promise.all([
      request.listProjects(),
      request.listSessions(),
    ]);
    setProjects(nextProjects ?? []);
    setSessions(nextSessions ?? []);
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

  // handleAddProjectRef 只在 window 事件回调中读取，因此在 effect 阶段同步最新值
  useEffect(() => {
    handleAddProjectRef.current = handleAddProject;
  });

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

  const handleSelectAssistant = (assistant: AssistantConfig) => {
    if (assistant.disabled) return;
    // Same as sessions: opening a finished conversation clears its indicator.
    const state = useAppStore.getState().sessionStates.get(assistant.id);
    if (state?.completedAt) {
      useAppStore.getState().updateSessionState(assistant.id, () => ({
        completedAt: null,
        completedStatus: null,
      }));
    }
    handleNavigate(`/assistant/${assistant.id}`);
  };

  const handleSessionCreated = async (projectId: string, sessionId: string) => {
    await refreshData();
    setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
    handleNavigate(`/session-view/${sessionId}`);
  };

  const handleSetActiveIlinkSession = async (sessionId: string) => {
    try {
      await request.setActiveIlinkSession({ sessionId });
    } catch (err) {
      console.error("Failed to update WeChat active session:", err);
      toast.error(
        getErrorMessage(
          err,
          t("sidebar.failedToUpdateIlinkSession", "Failed to update WeChat active session."),
        ),
      );
    }
  };

  /** 打开重命名弹层：输入框从用户标题开始，没有用户标题时为空。 */
  const handleRenameSession = (session: SessionInfo) => {
    setRenameTarget(session);
    setRenameTitle(session.userTitle ?? "");
  };

  /**
   * 提交重命名。
   *
   * 用户点确认就是「用这个标题锁住」，即使内容与当前的 Agent 标题一致也要写入 userTitle
   * （否则 Agent 之后还能改掉它）。只有与已设置的用户标题完全一致、或本来就没有用户标题
   * 却提交空值时，才跳过这次无意义的写入。
   */
  const submitRenameSession = async () => {
    const session = renameTarget;
    if (!session) return;
    const nextUserTitle = renameTitle.trim() || null;
    setRenameTarget(null);
    if (nextUserTitle === session.userTitle) return;
    try {
      await renameSession(session.id, renameTitle);
      await refreshData();
    } catch (err) {
      toast.error(
        getErrorMessage(err, t("sidebar.failedToRenameSession", "Failed to rename the session.")),
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

  /**
   * 默认展开策略：
   * - 只有一个项目时全展开；
   * - 多个项目时只展开「有会话已连接或为微信活跃」的项目。
   *
   * 只在初始化（首次拿到项目列表）那一刻定一次，之后不再跟随连接 / 微信活跃状态变化，
   * 避免用着用着项目被自动展开或收起。手动切换过的项目始终以 `expandedProjects` 为准。
   */
  const defaultExpandedProjectIds = useMemo(() => {
    const ids = new Set<string>();
    if (sortedProjects.length <= 1) {
      for (const project of sortedProjects) ids.add(project.id);
      return ids;
    }
    for (const project of sortedProjects) {
      const hasActiveSession = (sessionsByProject[project.id] ?? []).some(
        (session) =>
          session.connectionStatus === "connected" || session.id === activeIlinkSessionId,
      );
      if (hasActiveSession) ids.add(project.id);
    }
    return ids;
  }, [activeIlinkSessionId, sortedProjects, sessionsByProject]);

  // 初始化快照；为 null 时先用实时计算值，保证首帧不会先渲染成全部收起。
  const [initialExpandedProjectIds, setInitialExpandedProjectIds] = useState<Set<string> | null>(
    null,
  );
  useEffect(() => {
    if (initialExpandedProjectIds !== null || sortedProjects.length === 0) return;
    // eslint-disable-next-line react/set-state-in-effect
    setInitialExpandedProjectIds(defaultExpandedProjectIds);
  }, [defaultExpandedProjectIds, initialExpandedProjectIds, sortedProjects.length]);

  const isProjectExpanded = useCallback(
    (projectId: string) =>
      expandedProjects[projectId] ??
      (initialExpandedProjectIds ?? defaultExpandedProjectIds).has(projectId),
    [defaultExpandedProjectIds, expandedProjects, initialExpandedProjectIds],
  );
  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !isProjectExpanded(projectId) }));
  };

  const navigationItemRefs = useRef(new Map<string, HTMLDivElement>());
  const addProjectButtonRef = useRef<HTMLButtonElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const navigationItems = useMemo(() => {
    // 个人助理固定在项目区上方；全局关闭或单个 disabled 时不参与键盘导航。
    const items: SidebarNavigationItem[] = assistantEnabled
      ? assistants
          .filter((assistant) => !assistant.disabled)
          .map((assistant) => ({ type: "assistant" as const, id: assistant.id }))
      : [];
    for (const project of sortedProjects) {
      items.push({ type: "project", id: project.id });
      if (isProjectExpanded(project.id)) {
        for (const session of sessionsByProject[project.id] ?? []) {
          items.push({ type: "session", id: session.id, projectId: project.id });
        }
      }
    }
    return items;
  }, [assistantEnabled, assistants, isProjectExpanded, sessionsByProject, sortedProjects]);

  const focusNavigationItem = useCallback(
    (item: SidebarNavigationItem) => {
      let element: HTMLElement | undefined = navigationItemRefs.current.get(
        sidebarNavigationItemKey(item),
      );
      if (!element) {
        // 兜底查询只覆盖项目树里的行（不含上方的个人助理），索引也要排除它
        const itemIndex = navigationItems
          .filter((navigationItem) => navigationItem.type !== "assistant")
          .findIndex(
            (navigationItem) =>
              sidebarNavigationItemKey(navigationItem) === sidebarNavigationItemKey(item),
          );
        // 收起项目的会话虽然仍挂载（为了保留收起动画），但被包在 inert 容器里，
        // 不能参与索引，否则焦点会落到错误的行上。
        element = Array.from(
          sessionListRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
        ).filter((candidate) => !candidate.closest("[inert]"))[itemIndex];
      }
      if (!element) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest" });
    },
    [navigationItems],
  );

  const focusSidebarSessions = useCallback(() => {
    const focusVisibleItem = () => {
      const activeSession = sessions.find((session) => session.id === activeSessionId);
      const targetItem = activeSession
        ? (navigationItems.find(
            (item) => item.type === "session" && item.id === activeSession.id,
          ) ??
          navigationItems.find(
            (item) => item.type === "project" && item.id === activeSession.projectId,
          ))
        : navigationItems[0];

      if (targetItem) {
        focusNavigationItem(targetItem);
      } else {
        addProjectButtonRef.current?.focus({ preventScroll: true });
      }
    };

    if (!sidebarOpen) {
      setSidebarOpen(true);
    }
    window.requestAnimationFrame(focusVisibleItem);
  }, [
    activeSessionId,
    focusNavigationItem,
    navigationItems,
    sessions,
    setSidebarOpen,
    sidebarOpen,
  ]);

  useFocusTarget("sidebar-sessions", focusSidebarSessions);

  const handleNavigationKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    item: SidebarNavigationItem,
  ) => {
    const { key } = event;
    const isVerticalNavigationKey = key === "ArrowUp" || key === "ArrowDown";

    if (isVerticalNavigationKey) {
      event.preventDefault();
      event.stopPropagation();

      const currentIndex = navigationItems.findIndex(
        (navigationItem) =>
          sidebarNavigationItemKey(navigationItem) === sidebarNavigationItemKey(item),
      );
      if (navigationItems.length === 0) return;
      // 「添加项目」按钮位于第一个项目行上方；个人助理开启时占据第 0 项，
      // 因此按「第一个非助理项」判断，保证按钮始终可通过 ArrowUp 到达。
      const firstProjectIndex = navigationItems.findIndex(
        (navigationItem) => navigationItem.type !== "assistant",
      );
      if (key === "ArrowUp" && currentIndex === firstProjectIndex && item.type === "project") {
        addProjectButtonRef.current?.focus({ preventScroll: true });
        return;
      }
      const nextIndex = Math.max(
        0,
        Math.min(navigationItems.length - 1, currentIndex + (key === "ArrowDown" ? 1 : -1)),
      );
      const nextItem = navigationItems[nextIndex];
      if (nextItem) focusNavigationItem(nextItem);
      return;
    }

    if (isContextMenuKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      openContextMenuFromKeyboard(event.currentTarget);
      return;
    }

    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();

      // 个人助理没有子项，也没有上级项目，左右键不处理
      if (item.type === "assistant") return;

      if (item.type === "project") {
        if (key === "ArrowLeft") {
          if (isProjectExpanded(item.id)) {
            setExpandedProjects((prev) => ({ ...prev, [item.id]: false }));
          }
        } else if (!isProjectExpanded(item.id)) {
          setExpandedProjects((prev) => ({ ...prev, [item.id]: true }));
        } else {
          const firstChild = navigationItems.find(
            (navigationItem) =>
              navigationItem.type === "session" && navigationItem.projectId === item.id,
          );
          if (firstChild) focusNavigationItem(firstChild);
        }
      } else if (key === "ArrowLeft") {
        focusNavigationItem({ type: "project", id: item.projectId });
      }
      return;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      if (item.type === "assistant") {
        const target = assistants.find((assistant) => assistant.id === item.id);
        if (target) handleSelectAssistant(target);
      } else if (item.type === "project") {
        toggleProject(item.id);
      } else {
        const session = sessions.find((candidate) => candidate.id === item.id);
        if (session) void handleSelectSession(session);
      }
    }
  };

  const handleAddProjectKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      addProjectButtonRef.current?.focus({ preventScroll: true });
      return;
    }

    // 按钮上方是个人助理分区（关闭时不参与导航），ArrowUp 回到它
    if (key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const lastAssistant = [...navigationItems]
        .reverse()
        .find((item) => item.type === "assistant");
      if (lastAssistant) focusNavigationItem(lastAssistant);
      return;
    }

    if (key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      // 跳过上方的个人助理，落到它下面的第一个项目 / 会话
      const firstItem = navigationItems.find((item) => item.type !== "assistant");
      if (firstItem) focusNavigationItem(firstItem);
      return;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      void handleAddProject();
    }
  };

  const hoverState: SidebarHoverState = {
    hoverId,
    setHoverId,
    contextMenuId,
    setContextMenuId,
    hoveredTriggerIdRef,
  };

  const navigationBinding: SidebarNavigationBinding = {
    itemRefs: navigationItemRefs,
    listRef: sessionListRef,
    addProjectButtonRef,
    onItemKeyDown: handleNavigationKeyDown,
    onAddProjectKeyDown: handleAddProjectKeyDown,
  };

  return (
    <aside
      className={cn(
        // 窗口窄于 800px 时收窄到 w-40，把宽度让给会话内容；
        // 收起的负 margin 必须与宽度同步，router.tsx 里开关按钮的也要跟着改。
        "flex h-full min-h-0 w-60 max-[800px]:w-40 flex-col border-r border-border bg-sidebar text-sidebar-foreground pointer-events-auto transition-[margin,width] duration-200",
        {
          "-ml-60 max-[800px]:-ml-40": !sidebarOpen,
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
      <SidebarNav currentPath={currentPath} onNavigate={handleNavigate} />
      {/* 个人助理区：固定在「项目」上方，每个助理一行；全局关闭时整段隐藏。 */}
      {assistantEnabled && (
        <AssistantSection
          assistants={assistants}
          activeAssistantId={activeAssistantId}
          activeIlinkSessionId={activeIlinkSessionId}
          ilinkConnected={ilinkStatus.connected}
          hover={hoverState}
          navigation={navigationBinding}
          onOpenNewAssistant={openNewAssistantDialog}
          onSelectAssistant={handleSelectAssistant}
          onSetActiveIlinkSession={handleSetActiveIlinkSession}
          onNavigate={handleNavigate}
        />
      )}
      {/* 项目区（标题 + 列表）整体作为「拖入文件夹添加项目」的落点，行为与点「添加项目」按钮一致 */}
      <ProjectTree
        projects={sortedProjects}
        sessionsByProject={sessionsByProject}
        configuredAgents={configuredAgents}
        activeSessionId={activeSessionId}
        activeIlinkSessionId={activeIlinkSessionId}
        ilinkConnected={ilinkStatus.connected}
        isProjectExpanded={isProjectExpanded}
        onToggleProject={toggleProject}
        onExpandProject={(projectId) =>
          setExpandedProjects((prev) => ({ ...prev, [projectId]: true }))
        }
        refreshData={refreshData}
        onOpenNewSession={openNewSessionDialog}
        onSelectSession={handleSelectSession}
        onRenameSession={handleRenameSession}
        onSetActiveIlinkSession={handleSetActiveIlinkSession}
        onNavigate={handleNavigate}
        onAddProject={handleAddProject}
        hover={hoverState}
        navigation={navigationBinding}
      />

      <div className="mt-auto">
        {/* 有可用更新时在这里安静地展示升级状态，不再用顶部 toast 打断用户 */}
        <UpdateCard />
        <div className="border-t border-border">
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
      </div>

      <RenameSessionDialog
        session={renameTarget}
        value={renameTitle}
        onValueChange={setRenameTitle}
        onClose={() => setRenameTarget(null)}
        onSubmit={() => void submitRenameSession()}
      />

      <NewSessionDialog
        ref={newSessionDialogRef}
        onCreated={handleSessionCreated}
        onNeedAgent={handleNeedAgent}
      />

      <NewAssistantDialog
        ref={newAssistantDialogRef}
        onCreated={(assistantId) => handleNavigate(`/assistant/${assistantId}`)}
        onNeedAgent={handleNeedAgent}
      />
    </aside>
  );
}
