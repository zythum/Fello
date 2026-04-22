import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "./store";
import { request, subscribe, BackendEvents } from "./backend";
import { reduceSessionUpdate } from "./lib/session-state-reducer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageProvider, useMessage } from "./components/providers/message";
import { ThemeProvider } from "./components/providers/theme";
import { PermissionDialog } from "./components/global/permission-dialog";
import { GlobalTextContextMenu } from "./components/global/global-text-context-menu";
import { AppRouter } from "./router";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";

function AppContent() {
  const {
    setSessions,
    setProjects,
    setConfiguredAgents,
    setConfiguredMcpServers,
    setWebUIStatus,
    setTheme,
    setI18n,
    isMacApp,
    setIsFullScreen,
  } = useAppStore();
  const { t, i18n } = useTranslation();
  const { toast } = useMessage();
  const location = useLocation();
  const matchSession = location.pathname.match(/^\/session-view\/(.+)$/);
  const activeSessionId = matchSession ? matchSession[1] : null;
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  const navigate = useNavigate();
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
      setConfiguredMcpServers(settings.mcpServers || []);
      setWebUIStatus(webUIStatus);
      if (settings.theme) setTheme(settings.theme);
      if (settings.i18n) {
        setI18n(settings.i18n);
        i18n.changeLanguage(settings.i18n.language);
      }
      setIsReady(true);
    }
    void loadData();
  }, [
    setProjects,
    setSessions,
    setConfiguredAgents,
    setConfiguredMcpServers,
    setWebUIStatus,
    setTheme,
    setI18n,
    i18n,
  ]);

  useEffect(() => {
    let unlistenFullScreen: (() => void) | undefined;
    const flushPendingSessionUpdates = () => {
      sessionUpdateFlushRafIdRef.current = null;
      const store = useAppStore.getState();
      const budgetMs = 8;
      const start = performance.now();

      for (const [sid, updates] of pendingSessionUpdatesRef.current.entries()) {
        // 1. Remove from queue first. If we don't finish, we will re-insert it at the end (Round-Robin)
        pendingSessionUpdatesRef.current.delete(sid);

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

    const handleSessionUpdate = (detail: BackendEvents["session-update"]) => {
      const sid = detail.sessionId;
      const update = detail.notification.update;

      const store = useAppStore.getState();

      if (!store.sessionStates.has(sid)) {
        return; // Hibernated, discard
      }

      const sessionState = store.sessionStates.get(sid);
      if (sessionState?.isLoading) {
        store.updateSessionState(sid, (s) => ({ pendingUpdates: [...s.pendingUpdates, update] }));
        return;
      }

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

      toast.custom(
        (t: string | number) => (
          <PermissionDialog request={detail.request} sessionId={sid} toastId={t} />
        ),
        {
          duration: Infinity,
          id: `perm-${sid}-${detail.request.toolCall.toolCallId}`,
        },
      );
    };

    const handlePermissionResolved = (detail: BackendEvents["permission-resolved"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      useAppStore.getState().removePermissionRequest(sid, detail.toolCallId);
      toast.dismiss(`perm-${sid}-${detail.toolCallId}`);
    };

    const handleAgentTerminalOutput = (detail: BackendEvents["agent-terminal-output"]) => {
      useAppStore.getState().appendTerminalLog(detail.terminalId, detail.data);
    };

    const handleWebUIStatusChanged = (detail: BackendEvents["webui-status-changed"]) => {
      useAppStore.getState().setWebUIStatus(detail.status);
    };

    const handleSessionChanged = (detail: BackendEvents["session-changed"]) => {
      useAppStore.getState().updateSession(detail.session);
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
      const currentActiveSessionId = activeSessionIdRef.current;
      const prevActiveSessionTitle =
        prevSessions.find((s) => s.id === currentActiveSessionId)?.title ?? null;
      const nextSessions = (await request.listSessions()) ?? [];
      if (fetchId !== currentSessionsFetchId) return;

      const store = useAppStore.getState();

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
        if (prevActiveSessionTitle) {
          toast.info(t("toast.activeSessionDeletedWithTitle", { title: prevActiveSessionTitle }));
        } else {
          toast.info(t("toast.activeSessionDeleted"));
        }
        const nextSession = nextSessions[0];
        if (nextSession) {
          navigate(`/session-view/${nextSession.id}`);
        } else {
          navigate("/");
        }
      }
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("permission-request", handlePermissionRequest);
    subscribe.on("permission-resolved", handlePermissionResolved);
    subscribe.on("agent-terminal-output", handleAgentTerminalOutput);
    subscribe.on("webui-status-changed", handleWebUIStatusChanged);
    subscribe.on("projects-changed", handleProjectsChanged);
    subscribe.on("sessions-changed", handleSessionsChanged);
    subscribe.on("session-changed", handleSessionChanged);

    const fello = window.fello;
    if (isMacApp && fello?.onMacFullScreen) {
      unlistenFullScreen = fello.onMacFullScreen((isFull) => setIsFullScreen(isFull));
    }

    return () => {
      if (unlistenFullScreen) unlistenFullScreen();
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("permission-request", handlePermissionRequest);
      subscribe.off("permission-resolved", handlePermissionResolved);
      subscribe.off("agent-terminal-output", handleAgentTerminalOutput);
      subscribe.off("webui-status-changed", handleWebUIStatusChanged);
      subscribe.off("projects-changed", handleProjectsChanged);
      subscribe.off("sessions-changed", handleSessionsChanged);
      subscribe.off("session-changed", handleSessionChanged);
      if (sessionUpdateFlushRafIdRef.current != null) {
        cancelAnimationFrame(sessionUpdateFlushRafIdRef.current);
        sessionUpdateFlushRafIdRef.current = null;
      }
      pendingSessionUpdatesRef.current.clear();
    };
  }, [isMacApp]);

  if (!isReady) {
    return null; // Don't render anything until initial data and theme are loaded
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
    <ThemeProvider>
      <MessageProvider>
        <HashRouter>
          <AppContent />
        </HashRouter>
      </MessageProvider>
    </ThemeProvider>
  );
}

export default App;
