import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "./store";
import { request, subscribe, BackendEvents } from "./backend";
import { reduceSessionUpdate } from "./lib/session-state-reducer";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageProvider, useMessage } from "@/components/message";
import { ThemeProvider } from "./components/theme-provider";
import { GlobalTextContextMenu } from "./components/global-text-context-menu";

function AppContent() {
  const {
    setSessions,
    setProjects,
    globalErrorMessages,
    shiftGlobalErrorMessage,
    setConfiguredAgents,
    setTheme,
    setI18n,
  } = useAppStore();
  const { t, i18n } = useTranslation();
  const { alert, toast } = useMessage();
  const currentGlobalError = globalErrorMessages[0] ?? null;
  const [isReady, setIsReady] = useState(false);
  const pendingSessionUpdatesRef = useRef(
    new Map<string, BackendEvents["session-update"]["notification"]["update"][]>(),
  );
  const sessionUpdateFlushRafIdRef = useRef<number | null>(null);

  useEffect(() => {
    async function loadData() {
      const [projects, sessions, settings, webUIStatus] = await Promise.all([
        request.listProjects(),
        request.listSessions(),
        request.getSettings(),
        request.getWebUIStatus(),
      ]);
      setProjects(projects ?? []);
      setSessions(sessions ?? []);
      setConfiguredAgents(settings.agents);
      useAppStore.getState().setWebUIStatus(webUIStatus);
      if (settings.theme) setTheme(settings.theme);
      if (settings.i18n) {
        setI18n(settings.i18n);
        i18n.changeLanguage(settings.i18n.language);
      }
      setIsReady(true);
    }
    void loadData();
  }, [setProjects, setSessions, setConfiguredAgents, setTheme, setI18n, i18n]);

  useEffect(() => {
    const flushPendingSessionUpdates = () => {
      sessionUpdateFlushRafIdRef.current = null;
      const store = useAppStore.getState();
      const budgetMs = 8;
      const start = performance.now();

      for (const [sid, updates] of pendingSessionUpdatesRef.current.entries()) {
        // 1. Remove from queue first. If we don't finish, we will re-insert it at the end (Round-Robin)
        pendingSessionUpdatesRef.current.delete(sid);

        // 2. Drop updates if session no longer exists
        const sessionExists = store.sessions.some((s) => s.id === sid);
        if (!sessionExists) {
          continue;
        }

        let nextTitle: string | null = null;
        let processedCount = 0;

        // 3. Apply batch of updates securely on top of the freshest state
        store.updateSessionState(sid, (currentState) => {
          let state = currentState;
          for (let i = 0; i < updates.length; i++) {
            const update = updates[i];
            if (update?.sessionUpdate === "session_info_update" && update.title) {
              nextTitle = update.title;
            }
            state = reduceSessionUpdate(state, update);
            processedCount++;

            // Break inner loop if time budget exceeded
            if (performance.now() - start > budgetMs) {
              break;
            }
          }
          return state;
        });

        // 4. Handle side-effects
        if (nextTitle) {
          request.updateSessionTitle({ sessionId: sid, title: nextTitle });
        }

        // 5. Re-queue unprocessed updates
        if (processedCount < updates.length) {
          // By setting it again, it moves to the end of Map iteration order
          pendingSessionUpdatesRef.current.set(sid, updates.slice(processedCount));
        }

        // 6. Break outer loop if time budget exceeded
        if (performance.now() - start > budgetMs) {
          break;
        }
      }

      // 7. Schedule next flush if there are still items in the queue
      if (pendingSessionUpdatesRef.current.size > 0) {
        scheduleFlushPendingSessionUpdates();
      }
    };

    const scheduleFlushPendingSessionUpdates = () => {
      if (sessionUpdateFlushRafIdRef.current != null) return;
      sessionUpdateFlushRafIdRef.current = requestAnimationFrame(flushPendingSessionUpdates);
    };

    const handleSessionClear = (detail: BackendEvents["session-clear"]) => {
      pendingSessionUpdatesRef.current.delete(detail.sessionId);
      useAppStore.getState().updateSessionState(detail.sessionId, () => ({
        messages: [],
        usage: null,
        isStreaming: false,
        permissionRequests: [],
        activeToolCalls: new Map(),
        availableModels: [],
        currentModelId: null,
        availableModes: [],
        currentModeId: null,
        agentInfo: null,
      }));
    };

    const handleSessionUpdate = (detail: BackendEvents["session-update"]) => {
      const sessions = useAppStore.getState().sessions;
      const targetSession = sessions.find((s) => s.id === detail.sessionId);

      // Strict matching: Only process updates for the specific session indicated by the backend
      // Do not fallback to activeSessionId to prevent cross-session data corruption
      if (!targetSession) return;
      const sid = targetSession.id;
      const update = detail.notification.update;
      
      let pending = pendingSessionUpdatesRef.current.get(sid);
      if (!pending) {
        pending = [];
        pendingSessionUpdatesRef.current.set(sid, pending);
      }
      pending.push(update);
      
      scheduleFlushPendingSessionUpdates();
    };

    const handlePermissionRequest = (detail: BackendEvents["permission-request"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      useAppStore.getState().addPermissionRequest(sid, detail.request);
    };

    const handleAgentTerminalOutput = (detail: BackendEvents["agent-terminal-output"]) => {
      useAppStore.getState().appendTerminalLog(detail.terminalId, detail.data);
    };

    const handleWebUIStatusChanged = (detail: BackendEvents["webui-status-changed"]) => {
      useAppStore.getState().setWebUIStatus(detail.status);
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
      const prevSessions = useAppStore.getState().sessions;
      const prevActiveSessionId = useAppStore.getState().activeSessionId;
      const prevActiveSessionTitle =
        prevSessions.find((s) => s.id === prevActiveSessionId)?.title ?? null;
      const nextSessions = (await request.listSessions()) ?? [];
      if (fetchId !== currentSessionsFetchId) return;

      const store = useAppStore.getState();
      const currentActiveSessionId = store.activeSessionId;
      store.setSessions(nextSessions);

      const sessionIds = new Set(nextSessions.map((s) => s.id));
      const nextStates = new Map(
        Array.from(store.sessionStates.entries()).filter(([sid]) => sessionIds.has(sid)),
      );
      useAppStore.setState({ sessionStates: nextStates });

      // 同步清理 pendingSessionUpdatesRef 中已删除的会话
      for (const sid of pendingSessionUpdatesRef.current.keys()) {
        if (!sessionIds.has(sid)) {
          pendingSessionUpdatesRef.current.delete(sid);
        }
      }

      if (currentActiveSessionId && !sessionIds.has(currentActiveSessionId)) {
        if (prevActiveSessionId === currentActiveSessionId && prevActiveSessionTitle) {
          toast.info(t("toast.activeSessionDeletedWithTitle", { title: prevActiveSessionTitle }));
        } else {
          toast.info(t("toast.activeSessionDeleted"));
        }
        store.setActiveSessionId(nextSessions[0]?.id ?? null);
      }
    };

    subscribe.on("session-clear", handleSessionClear);
    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("permission-request", handlePermissionRequest);
    subscribe.on("agent-terminal-output", handleAgentTerminalOutput);
    subscribe.on("webui-status-changed", handleWebUIStatusChanged);
    subscribe.on("projects-changed", handleProjectsChanged);
    subscribe.on("sessions-changed", handleSessionsChanged);
    return () => {
      subscribe.off("session-clear", handleSessionClear);
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("permission-request", handlePermissionRequest);
      subscribe.off("agent-terminal-output", handleAgentTerminalOutput);
      subscribe.off("webui-status-changed", handleWebUIStatusChanged);
      subscribe.off("projects-changed", handleProjectsChanged);
      subscribe.off("sessions-changed", handleSessionsChanged);
      if (sessionUpdateFlushRafIdRef.current != null) {
        cancelAnimationFrame(sessionUpdateFlushRafIdRef.current);
        sessionUpdateFlushRafIdRef.current = null;
      }
      pendingSessionUpdatesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!currentGlobalError) return;

    const showError = async () => {
      await alert({
        title: t("message.errorTitle", "Error"),
        content: currentGlobalError,
      });
      shiftGlobalErrorMessage();
    };

    void showError();
  }, [currentGlobalError, alert, shiftGlobalErrorMessage]);

  if (!isReady) {
    return null; // Don't render anything until initial data and theme are loaded
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <SessionView />
        <GlobalTextContextMenu />
      </div>
    </TooltipProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <MessageProvider>
        <AppContent />
      </MessageProvider>
    </ThemeProvider>
  );
}

export default App;
