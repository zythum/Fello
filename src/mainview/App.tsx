import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { liveSessionIds, useAppStore } from "./store";
import type { AssistantConfig, SessionInfo } from "../shared/schema";
import i18n from "./i18n";
import { request, subscribe, BackendEvents } from "./backend";
import { reduceSessionNotification } from "./lib/session-state-reducer";
import { isSessionLifecycleBusy } from "./lib/session-lifecycle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageProvider, useMessage } from "./components/providers/message";
import { ThemeProvider } from "./components/providers/theme";

import { GlobalTextContextMenu } from "./components/global/global-text-context-menu";
import { ErrorBoundary } from "./components/global/error-boundary";
import { AppRouter } from "./router";
import { FocusTargetProvider, useFocusTargetRegistry } from "./lib/keyboard";
import { PeripheralRuntime } from "./lib/peripherals/peripheral-runtime";
import { VoicePanelProvider } from "./lib/peripherals/voice-panel-provider";
import { createAppCommands } from "./lib/commands/command-catalog";
import { useCommandShortcuts } from "./lib/commands/use-command-shortcuts";
import { onTtsError } from "./lib/tts/tts-reader";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import { electron, UpdaterEvent } from "./electron";
import * as tiks from "@rexa-developer/tiks";

const UPDATE_TOAST_ID = "fello-app-update";

function AppContent() {
  // 逐项按需订阅，避免用无 selector 的 useAppStore() 全量订阅整个 store：
  // 流式期间每个 token 都会写入 sessionStates，全量订阅会让 AppContent 每帧重渲染，
  // 并带着整棵 AppRouter/Sidebar 树一起重渲染，导致点击会话 / 切换路由明显延迟。
  // 下面这些 setter 都是稳定引用，用 selector 取不会引起额外重渲染。
  const isMacApp = useAppStore((s) => s.isMacApp);
  const setSessions = useAppStore((s) => s.setSessions);
  const setProjects = useAppStore((s) => s.setProjects);
  const setConfiguredAgents = useAppStore((s) => s.setConfiguredAgents);
  const setConfiguredMcpServers = useAppStore((s) => s.setConfiguredMcpServers);
  const setFeatures = useAppStore((s) => s.setFeatures);
  const setWebUIStatus = useAppStore((s) => s.setWebUIStatus);
  const setTheme = useAppStore((s) => s.setTheme);
  const setI18n = useAppStore((s) => s.setI18n);
  const setEditor = useAppStore((s) => s.setEditor);
  const setSnippets = useAppStore((s) => s.setSnippets);
  const setImageGeneration = useAppStore((s) => s.setImageGeneration);
  const setSpeechProviders = useAppStore((s) => s.setSpeechProviders);
  const setVoiceInput = useAppStore((s) => s.setVoiceInput);
  const setNotification = useAppStore((s) => s.setNotification);
  const setShortcuts = useAppStore((s) => s.setShortcuts);
  const setPeripherals = useAppStore((s) => s.setPeripherals);
  const setUpdaterEvent = useAppStore((s) => s.setUpdaterEvent);
  const setProxy = useAppStore((s) => s.setProxy);
  const setAssistant = useAppStore((s) => s.setAssistant);
  const setAssistants = useAppStore((s) => s.setAssistants);
  const setAssistantStatus = useAppStore((s) => s.setAssistantStatus);
  const setIsFullScreen = useAppStore((s) => s.setIsFullScreen);
  const setIlinkStatus = useAppStore((s) => s.setIlinkStatus);
  const setActiveIlinkSessionId = useAppStore((s) => s.setActiveIlinkSessionId);
  const shortcuts = useAppStore((state) => state.shortcuts);
  const { resolvedTheme } = useTheme();
  // 只取 t；i18n 用模块单例（见 loadData 里的说明，不能依赖 useTranslation 返回的实例）
  const { t } = useTranslation();
  const { toast } = useMessage();
  const location = useLocation();
  const matchSession = location.pathname.match(/^\/session-view\/(.+)$/);
  const activeSessionId = matchSession ? matchSession[1] : null;
  const activeSessionIdRef = useRef(activeSessionId);
  const { focus } = useFocusTargetRegistry();

  const commands = useMemo(() => createAppCommands(focus), [focus]);
  useCommandShortcuts(commands, shortcuts);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  // TTS 错误（未配置 provider / 鉴权失败等）统一 toast；自动朗读本身由 session 视图持有
  useEffect(() => {
    onTtsError((message) => {
      toast.error(message);
    });
    return () => onTtsError(null);
  }, [toast]);
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);
  const pendingSessionNotificationRef = useRef(
    new Map<string, BackendEvents["session-update"]["notification"][]>(),
  );
  const sessionUpdateFlushRafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (resolvedTheme === "light" || resolvedTheme === "dark") {
      electron.updateTheme(resolvedTheme);
    }
  }, [resolvedTheme]);

  useEffect(() => {
    let cancelled = false;

    /**
     * pending 的 askUser 请求只是「补状态」，不属于首屏必需内容。
     * 以前在这里逐个 await 串行拉取（N 个会话 = N 次往返）：WebUI 走 devtunnel 这类
     * 高 RTT 链路时，几十个会话就要多等十几秒才能出首屏。现在改成并发拉取，
     * 并且放到 isReady 之后启动，不再计入首屏耗时。
     */
    async function restorePendingState(sessions: SessionInfo[], assistants: AssistantConfig[]) {
      await Promise.all(
        sessions.map(async (session) => {
          try {
            const pending = await request.getPendingAskUserRequests({ sessionId: session.id });
            if (cancelled) return;
            for (const req of pending) {
              useAppStore.getState().addAskUserRequest(session.id, req);
            }
          } catch {
            // ignore
          }
        }),
      );

      // 个人助理是伪会话，不在 sessions 列表里，逐个恢复状态与 pending 请求。
      await Promise.all(
        assistants.map(async (assistant) => {
          try {
            const status = await request.getAssistantStatus({ assistantId: assistant.id });
            if (cancelled) return;
            setAssistantStatus(assistant.id, status);
          } catch {
            // ignore
          }
          try {
            const pending = await request.getPendingAskUserRequests({
              sessionId: assistant.id,
            });
            if (cancelled) return;
            if (pending.length > 0) {
              if (!useAppStore.getState().sessionStates.has(assistant.id)) {
                useAppStore.getState().resetSessionState(assistant.id);
              }
              for (const req of pending) {
                useAppStore.getState().addAskUserRequest(assistant.id, req);
              }
            }
          } catch {
            // ignore
          }
        }),
      );
    }

    async function loadData() {
      const [projects, sessions, settings, webUIStatus, ilinkStatus, ilinkActive, assistants] =
        await Promise.all([
          request.listProjects(),
          request.listSessions(),
          request.getSettings(),
          request.getWebUIStatus(),
          request.getIlinkStatus(),
          request.getActiveIlinkSession(),
          request.listAssistants(),
        ]);
      if (cancelled) return;
      setProjects(projects ?? []);
      setSessions(sessions ?? []);
      setAssistants(assistants ?? []);
      setConfiguredAgents(settings.agents);
      setConfiguredMcpServers(settings.mcpServers);
      setFeatures(settings.features);
      setWebUIStatus(webUIStatus);
      setIlinkStatus(ilinkStatus);
      setActiveIlinkSessionId(ilinkActive.sessionId);
      if (settings.theme) setTheme(settings.theme);
      if (settings.i18n) {
        setI18n(settings.i18n);
        // 用模块单例而不是 useTranslation() 返回的实例：后者在语言变化时会换成新的
        // Proxy（react-i18next v18），会污染本 effect 的依赖数组。
        i18n.changeLanguage(settings.i18n.language);
      }
      if (settings.proxy) setProxy(settings.proxy);
      if (settings.assistant) setAssistant(settings.assistant);
      if (settings.editor) setEditor(settings.editor);
      if (settings.snippets) setSnippets(settings.snippets);
      if (settings.imageGeneration) setImageGeneration(settings.imageGeneration);
      if (settings.speechProviders) setSpeechProviders(settings.speechProviders);
      if (settings.voiceInput) setVoiceInput(settings.voiceInput);
      if (settings.notification) setNotification(settings.notification);
      if (settings.shortcuts) setShortcuts(settings.shortcuts);
      if (settings.peripherals) setPeripherals(settings.peripherals);

      tiks.init();
      if (settings.sound.muted) {
        tiks.mute();
      } else {
        tiks.unmute();
      }
      tiks.setVolume(settings.sound.volume / 100);
      tiks.setTheme(settings.sound.theme);
      setIsReady(true);
      // 首屏已就绪，再补齐 pending 状态。
      void restorePendingState(sessions ?? [], assistants ?? []);
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    setProjects,
    setSessions,
    setConfiguredAgents,
    setConfiguredMcpServers,
    setFeatures,
    setWebUIStatus,
    setTheme,
    setI18n,
    // 不要把 i18n 放进依赖：react-i18next v18 在语言变化时返回新的 Proxy 实例，
    // 而 loadData 里会调用 changeLanguage()，放依赖会让整套初始化重跑一遍。
    setEditor,
    setSnippets,
    setImageGeneration,
    setSpeechProviders,
    setVoiceInput,
    setNotification,
    setShortcuts,
    setPeripherals,
    setProxy,
    setAssistant,
    setAssistants,
    setAssistantStatus,
    setIlinkStatus,
    setActiveIlinkSessionId,
  ]);

  useEffect(() => {
    if (!isReady) return;
    void electron.rendererReady();
  }, [isReady]);

  useEffect(() => {
    const map = pendingSessionNotificationRef.current;
    const flushPendingSessioNotificationss = () => {
      sessionUpdateFlushRafIdRef.current = null;
      const store = useAppStore.getState();
      // 个人助理是伪会话，同样走 session-update；存活集合必须包含助理，
      // 否则助理的流式通知会在这一层被静默丢弃。
      const liveIds = liveSessionIds(store);
      const budgetMs = 8;
      const start = performance.now();

      for (const [sid, notifications] of pendingSessionNotificationRef.current.entries()) {
        // Remove from queue first. If we don't finish, we will re-insert it at the end (Round-Robin)
        pendingSessionNotificationRef.current.delete(sid);

        let processedCount = 0;

        // Drop queued updates for sessions / assistants that were deleted before this RAF ran.
        if (!liveIds.has(sid)) {
          continue;
        }

        // Apply batch of updates securely on top of the freshest state.
        // The loading check must happen inside the updater because a lifecycle
        // operation may set isLoading after this RAF was scheduled.
        store.updateSessionState(sid, (currentState) => {
          if (currentState.isLoading || isSessionLifecycleBusy(sid)) {
            processedCount = notifications.length;
            return {
              pendingNotifications: [...currentState.pendingNotifications, ...notifications],
            };
          }

          let state = currentState;
          for (let i = 0; i < notifications.length; i++) {
            const notification = notifications[i];
            state = reduceSessionNotification(sid, state, notification);
            processedCount++;

            // Break inner loop if time budget exceeded
            if (performance.now() - start > budgetMs) {
              break;
            }
          }
          return {
            ...state,
            liveHistoryNotifications: [
              ...state.liveHistoryNotifications,
              ...notifications.slice(0, processedCount),
            ],
          };
        });

        // Re-queue unprocessed updates
        if (processedCount < notifications.length) {
          // By setting it again, it moves to the end of Map iteration order
          pendingSessionNotificationRef.current.set(sid, notifications.slice(processedCount));
        }

        // Break outer loop if time budget exceeded
        if (performance.now() - start > budgetMs) {
          break;
        }
      }

      // Schedule next flush if there are still items in the queue
      if (pendingSessionNotificationRef.current.size > 0) {
        scheduleFlushPendingSessioNnotificationss();
      }
    };

    const scheduleFlushPendingSessioNnotificationss = () => {
      if (sessionUpdateFlushRafIdRef.current != null) return;
      sessionUpdateFlushRafIdRef.current = requestAnimationFrame(flushPendingSessioNotificationss);
    };

    const handleSessionUpdate = (detail: BackendEvents["session-update"]) => {
      const sid = detail.sessionId;
      const notification = detail.notification;

      const store = useAppStore.getState();

      if (!store.sessionStates.has(sid)) {
        return; // Hibernated, discard
      }

      const sessionState = store.sessionStates.get(sid);
      if (sessionState?.isLoading) {
        store.updateSessionState(sid, (s) => ({
          pendingNotifications: [...s.pendingNotifications, notification],
        }));
        return;
      }

      let pending = pendingSessionNotificationRef.current.get(sid);
      if (!pending) {
        pending = [];
        pendingSessionNotificationRef.current.set(sid, pending);
      }
      pending.push(notification);

      scheduleFlushPendingSessioNnotificationss();
    };

    const handleAskUserRequest = (detail: BackendEvents["ask-user-request"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      // 助理页面关闭时它的 store 桶可能不存在，必须先建桶，否则请求会被丢弃。
      const isAssistant = useAppStore
        .getState()
        .assistants.some((assistant) => assistant.id === sid);
      if (isAssistant && !useAppStore.getState().sessionStates.has(sid)) {
        useAppStore.getState().resetSessionState(sid);
      }
      useAppStore.getState().addAskUserRequest(sid, detail);
      tiks.pop();
    };

    const handleAskUserResponse = (detail: BackendEvents["ask-user-response"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      useAppStore.getState().removeAskUserRequest(sid, detail.askUserId);
    };

    const handleOpenSessionRequested = (detail: BackendEvents["open-session-requested"]) => {
      if (!detail.sessionId) return;
      navigate(`/session-view/${detail.sessionId}`);
    };

    const handleOpenAssistantRequested = (detail: BackendEvents["open-assistant-requested"]) => {
      if (!detail?.assistantId) return;
      const store = useAppStore.getState();
      const assistant = store.assistants.find((item) => item.id === detail.assistantId);
      if (!assistant || assistant.disabled || !store.assistant.enabled) return;
      navigate(`/assistant/${detail.assistantId}`);
    };

    const handleAgentTerminalOutput = (detail: BackendEvents["agent-terminal-output"]) => {
      const store = useAppStore.getState();
      if (!store.sessionStates.has(detail.sessionId)) {
        return; // Hibernated, discard
      }
      store.appendTerminalLog(detail.sessionId, detail.terminalId, detail.data);
    };

    const handleWebUIStatusChanged = (detail: BackendEvents["webui-status-changed"]) => {
      useAppStore.getState().setWebUIStatus(detail.status);
    };

    const handleSessionChanged = (detail: BackendEvents["session-changed"]) => {
      useAppStore.getState().updateSession(detail.session);
    };

    const handlePromptEnd = (detail: BackendEvents["prompt-end"]) => {
      const store = useAppStore.getState();
      if (!store.sessionStates.has(detail.sessionId)) return; // Session deleted, skip
      const isSuccess = !detail.error && detail.stopReason === "end_turn";
      store.updateSessionState(detail.sessionId, () => ({
        completedAt: detail.error ? null : Date.now(),
        completedStatus: detail.error ? null : isSuccess ? "success" : "error",
      }));
      if (isSuccess) {
        tiks.success();
      } else {
        tiks.error();
      }
    };

    const handleAssistantStatusChanged = (detail: BackendEvents["assistant-status-changed"]) => {
      useAppStore.getState().setAssistantStatus(detail.assistantId, detail.status);
    };

    let currentProjectsFetchId = 0;
    const handleProjectsChanged = async () => {
      const fetchId = ++currentProjectsFetchId;
      const nextProjects = await request.listProjects();
      if (fetchId !== currentProjectsFetchId) return;
      useAppStore.getState().setProjects(nextProjects ?? []);
    };

    let currentSessionsFetchId = 0;
    const handleSessionsChanged = async () => {
      const fetchId = ++currentSessionsFetchId;
      const currentActiveSessionId = activeSessionIdRef.current;
      const nextSessions = (await request.listSessions()) ?? [];
      if (fetchId !== currentSessionsFetchId) return;

      const store = useAppStore.getState();

      store.setSessions(nextSessions);

      const sessionIds = new Set(nextSessions.map((s) => s.id));
      const liveIds = liveSessionIds(useAppStore.getState());

      // Only update sessionStates if entries were actually removed
      const currentStates = store.sessionStates;
      let hasStale = false;
      for (const sid of currentStates.keys()) {
        if (!liveIds.has(sid)) {
          hasStale = true;
          break;
        }
      }
      if (hasStale) {
        const nextStates = new Map(
          Array.from(currentStates.entries()).filter(([sid]) => liveIds.has(sid)),
        );
        useAppStore.setState({ sessionStates: nextStates });
      }

      // 同步清理 pendingSessionUpdatesRef 中已删除的会话
      for (const sid of pendingSessionNotificationRef.current.keys()) {
        if (!liveIds.has(sid)) {
          pendingSessionNotificationRef.current.delete(sid);
        }
      }

      if (currentActiveSessionId && !sessionIds.has(currentActiveSessionId)) {
        navigate("/");
      }
    };

    const handleAssistantsChanged = (list: AssistantConfig[]) => {
      const store = useAppStore.getState();
      const previousIds = new Set(store.assistants.map((assistant) => assistant.id));
      store.setAssistants(list ?? []);
      const nextIds = new Set((list ?? []).map((assistant) => assistant.id));
      const removed = [...previousIds].filter((id) => !nextIds.has(id));
      if (removed.length > 0) {
        const states = new Map(useAppStore.getState().sessionStates);
        const statuses = new Map(useAppStore.getState().assistantStatuses);
        for (const id of removed) {
          states.delete(id);
          statuses.delete(id);
        }
        useAppStore.setState({ sessionStates: states, assistantStatuses: statuses });
      }
      const path = window.location.hash.replace(/^#/, "");
      const match = path.match(/^\/assistant\/([^/?#]+)/);
      if (match) {
        const assistantId = decodeURIComponent(match[1]);
        const target = (list ?? []).find((assistant) => assistant.id === assistantId);
        if (!target || target.disabled || !useAppStore.getState().assistant.enabled) {
          navigate("/", { replace: true });
        }
      }
    };

    const handleIlinkStatusChanged = (detail: BackendEvents["ilink-status-changed"]) => {
      useAppStore.getState().setIlinkStatus(detail.status);
    };
    const handleIlinkActiveSessionChanged = (
      detail: BackendEvents["ilink-active-session-changed"],
    ) => {
      useAppStore.getState().setActiveIlinkSessionId(detail.sessionId);
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("ask-user-request", handleAskUserRequest);
    subscribe.on("ask-user-response", handleAskUserResponse);
    subscribe.on("open-session-requested", handleOpenSessionRequested);
    subscribe.on("open-assistant-requested", handleOpenAssistantRequested);
    subscribe.on("assistants-changed", handleAssistantsChanged);
    subscribe.on("assistant-status-changed", handleAssistantStatusChanged);
    subscribe.on("agent-terminal-output", handleAgentTerminalOutput);
    subscribe.on("webui-status-changed", handleWebUIStatusChanged);
    subscribe.on("projects-changed", handleProjectsChanged);
    subscribe.on("sessions-changed", handleSessionsChanged);
    subscribe.on("session-changed", handleSessionChanged);
    subscribe.on("prompt-end", handlePromptEnd);
    subscribe.on("ilink-status-changed", handleIlinkStatusChanged);
    subscribe.on("ilink-active-session-changed", handleIlinkActiveSessionChanged);

    let unlistenFullScreen: (() => void) | undefined;
    if (isMacApp) {
      unlistenFullScreen = electron.onMacFullScreen((isFull) => setIsFullScreen(isFull));
    }

    let unlistenUpdater: (() => void) | undefined;
    /**
     * 更新状态只写进 store，由侧边栏的升级卡片展示，不再用常驻 toast 抢占视野。
     * 仅「用户手动检查」的结果仍用一次性 toast 反馈，否则点了菜单没有任何回音。
     */
    const handleUpdaterEvent = (event: UpdaterEvent) => {
      switch (event.type) {
        case "checking":
          if (event.manual) {
            toast.loading(t("updater.checking", "Checking for updates..."), {
              id: UPDATE_TOAST_ID,
              duration: Infinity,
            });
          }
          break;
        case "available":
          // 用户主动检查发现更新时展开侧边栏：卡片在侧边栏里，收起状态下等于没有提示。
          if (event.manual) useAppStore.getState().setSidebarOpen(true);
          // 「同一版本已下载」的情况由主进程改写为 downloaded 事件，这里直接采用即可。
          setUpdaterEvent(event);
          toast.dismiss(UPDATE_TOAST_ID);
          break;
        case "download-progress":
          setUpdaterEvent(event);
          toast.dismiss(UPDATE_TOAST_ID);
          break;
        case "downloaded":
          // 手动检查发现「同一版本已下载」时也展开侧边栏，否则收起的侧边栏看不到待重启状态。
          if (event.manual) useAppStore.getState().setSidebarOpen(true);
          setUpdaterEvent(event);
          toast.dismiss(UPDATE_TOAST_ID);
          break;
        case "download-failed":
          // 下载失败：卡片保持在原位并提供「重试」，另用一次性 toast 说明原因。
          setUpdaterEvent(event);
          toast.error(event.message || t("updater.downloadFailed", "Update download failed"), {
            id: UPDATE_TOAST_ID,
            duration: 5000,
          });
          break;
        case "not-available":
          setUpdaterEvent(null);
          if (event.manual) {
            toast.success(t("updater.upToDate", "Fello is up to date."), {
              id: UPDATE_TOAST_ID,
              duration: 3000,
            });
          } else {
            toast.dismiss(UPDATE_TOAST_ID);
          }
          break;
        case "disabled":
          if (event.manual) {
            toast.info(t("updater.disabled", "Updates are available only in packaged builds."), {
              id: UPDATE_TOAST_ID,
              duration: 4000,
            });
          } else {
            toast.dismiss(UPDATE_TOAST_ID);
          }
          break;
        case "error":
          // 检查失败只提示，不动卡片：下载失败已由 download-failed 单独处理。
          if (event.manual) {
            toast.error(event.message, {
              id: UPDATE_TOAST_ID,
              duration: 5000,
            });
          } else {
            toast.dismiss(UPDATE_TOAST_ID);
          }
          break;
      }
    };
    // 渲染层重新挂载时恢复后端记住的更新状态（例如下载到一半刷新了窗口）。
    void electron.getUpdaterStatus().then((event) => {
      if (
        event &&
        (event.type === "available" ||
          event.type === "download-progress" ||
          event.type === "downloaded" ||
          event.type === "download-failed")
      ) {
        setUpdaterEvent(event);
      }
    });
    void electron.checkForUpdates(false).catch(() => {});
    unlistenUpdater = electron.onUpdater((event) => handleUpdaterEvent(event));

    return () => {
      if (unlistenFullScreen) unlistenFullScreen();
      if (unlistenUpdater) unlistenUpdater();
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("ask-user-request", handleAskUserRequest);
      subscribe.off("ask-user-response", handleAskUserResponse);
      subscribe.off("open-session-requested", handleOpenSessionRequested);
      subscribe.off("open-assistant-requested", handleOpenAssistantRequested);
      subscribe.off("assistants-changed", handleAssistantsChanged);
      subscribe.off("assistant-status-changed", handleAssistantStatusChanged);
      subscribe.off("agent-terminal-output", handleAgentTerminalOutput);
      subscribe.off("webui-status-changed", handleWebUIStatusChanged);
      subscribe.off("projects-changed", handleProjectsChanged);
      subscribe.off("sessions-changed", handleSessionsChanged);
      subscribe.off("session-changed", handleSessionChanged);
      subscribe.off("prompt-end", handlePromptEnd);
      subscribe.off("ilink-status-changed", handleIlinkStatusChanged);
      subscribe.off("ilink-active-session-changed", handleIlinkActiveSessionChanged);

      if (sessionUpdateFlushRafIdRef.current != null) {
        cancelAnimationFrame(sessionUpdateFlushRafIdRef.current);
        sessionUpdateFlushRafIdRef.current = null;
      }
      map.clear();
    };
  }, [isMacApp, setIsFullScreen, setUpdaterEvent, toast, t, navigate]);

  if (!isReady) {
    // 首屏数据/主题加载期间渲染主题背景色，避免空白（白闪）
    return <div className="h-full w-full bg-background" />;
  }

  return (
    <TooltipProvider>
      <AppRouter />
      <GlobalTextContextMenu />
    </TooltipProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MessageProvider>
          <HashRouter>
            <FocusTargetProvider>
              {/* 外设语音面板的状态机必须在 FocusTargetProvider 内：面板发送后要移动焦点 */}
              <VoicePanelProvider>
                <AppContent />
                <PeripheralRuntime />
              </VoicePanelProvider>
            </FocusTargetProvider>
          </HashRouter>
        </MessageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
