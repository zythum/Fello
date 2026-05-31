import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "./store";
import { request, subscribe, BackendEvents } from "./backend";
import { reduceSessionUpdate } from "./lib/session-state-reducer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageProvider, useMessage } from "./components/providers/message";
import { ThemeProvider } from "./components/providers/theme";

import { GlobalTextContextMenu } from "./components/global/global-text-context-menu";
import { ErrorBoundary } from "./components/global/error-boundary";
import { AppRouter } from "./router";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import { electron, UpdaterEvent } from "./electron";
import * as tiks from "@rexa-developer/tiks";

const UPDATE_TOAST_ID = "fello-app-update";

function AppContent() {
  const {
    setSessions,
    setProjects,
    setConfiguredAgents,
    setConfiguredMcpServers,
    setWebUIStatus,
    setTheme,
    setI18n,
    setSnippets,
    isMacApp,
    setIsFullScreen,
    setIlinkStatus,
    setActiveIlinkSessionId,
  } = useAppStore();
  const { i18n, t } = useTranslation();
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
      const [projects, sessions, settings, webUIStatus, ilinkStatus, ilinkActive] =
        await Promise.all([
          request.listProjects(),
          request.listSessions(),
          request.getSettings(),
          request.getWebUIStatus(),
          request.getIlinkStatus(),
          request.getActiveIlinkSession(),
        ]);
      setProjects(projects ?? []);
      setSessions(sessions ?? []);
      setConfiguredAgents(settings.agents);
      setConfiguredMcpServers(settings.mcpServers || []);
      setWebUIStatus(webUIStatus);
      setIlinkStatus(ilinkStatus);
      setActiveIlinkSessionId(ilinkActive.sessionId);
      if (settings.theme) setTheme(settings.theme);
      if (settings.i18n) {
        setI18n(settings.i18n);
        i18n.changeLanguage(settings.i18n.language);
      }
      if (settings.snippets) setSnippets(settings.snippets);
      // 恢复所有 session 中 pending 的 askUser 请求
      for (const session of sessions ?? []) {
        try {
          const pending = await request.getPendingAskUserRequests({ sessionId: session.id });
          for (const req of pending) {
            useAppStore.getState().addAskUserRequest(session.id, req);
          }
        } catch {
          // ignore
        }
      }

      tiks.init();
      if (settings.sound.muted) {
        tiks.mute();
      } else {
        tiks.unmute();
      }
      tiks.setVolume(settings.sound.volume / 100);
      tiks.setTheme(settings.sound.theme);
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
    const flushPendingSessionUpdates = () => {
      sessionUpdateFlushRafIdRef.current = null;
      const store = useAppStore.getState();
      const budgetMs = 8;
      const start = performance.now();

      for (const [sid, updates] of pendingSessionUpdatesRef.current.entries()) {
        // Remove from queue first. If we don't finish, we will re-insert it at the end (Round-Robin)
        pendingSessionUpdatesRef.current.delete(sid);

        let processedCount = 0;

        // Apply batch of updates securely on top of the freshest state
        store.updateSessionState(sid, (currentState) => {
          let state = currentState;
          for (let i = 0; i < updates.length; i++) {
            const update = updates[i];
            state = reduceSessionUpdate(state, update);
            processedCount++;

            // Break inner loop if time budget exceeded
            if (performance.now() - start > budgetMs) {
              break;
            }
          }
          return state;
        });

        // Re-queue unprocessed updates
        if (processedCount < updates.length) {
          // By setting it again, it moves to the end of Map iteration order
          pendingSessionUpdatesRef.current.set(sid, updates.slice(processedCount));
        }

        // Break outer loop if time budget exceeded
        if (performance.now() - start > budgetMs) {
          break;
        }
      }

      // Schedule next flush if there are still items in the queue
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

    const handleAskUserRequest = (detail: BackendEvents["ask-user-request"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      useAppStore.getState().addAskUserRequest(sid, detail);
      tiks.pop();
    };

    const handleAskUserResponse = (detail: BackendEvents["ask-user-response"]) => {
      const sid = detail.sessionId;
      if (!sid) return;
      useAppStore.getState().removeAskUserRequest(sid, detail.askUserId);
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
      const isSuccess = !detail.error && detail.stopReason === "end_turn";
      useAppStore.getState().updateSessionState(detail.sessionId, () => ({
        completedAt: detail.error ? null : Date.now(),
        completedStatus: detail.error ? null : isSuccess ? "success" : "error",
      }));
      if (isSuccess) {
        tiks.success();
      } else {
        tiks.error();
      }
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
        navigate("/");
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

    const showUpdaterActionError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || t("updater.actionFailed", "Update action failed"));
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("ask-user-request", handleAskUserRequest);
    subscribe.on("ask-user-response", handleAskUserResponse);
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
        case "available": {
          const version = event.info.version
            ? `v${event.info.version}`
            : t("updater.newVersion", "a new version");
          toast.info(t("updater.available", "Update available"), {
            id: UPDATE_TOAST_ID,
            description: event.info.releaseName || version,
            duration: Infinity,
            classNames: {
              content: "flex-1",
            },
            action: {
              label: t("updater.updateNow", "Update now"),
              onClick: () => {
                toast.loading(t("updater.startingDownload", "Starting download..."), {
                  id: UPDATE_TOAST_ID,
                  duration: Infinity,
                });
                void electron.downloadUpdate().catch(showUpdaterActionError);
              },
            },
            cancel: {
              label: t("updater.later", "Later"),
              onClick: () => toast.dismiss(UPDATE_TOAST_ID),
            },
          });
          break;
        }
        case "not-available":
          if (event.manual) {
            toast.success(t("updater.upToDate", "Fello is up to date."), {
              id: UPDATE_TOAST_ID,
              duration: 3000,
            });
          }
          break;
        case "download-progress":
          toast.loading(
            t("updater.downloading", "Downloading update {{percent}}%", {
              percent: Math.round(event.percent),
            }),
            {
              id: UPDATE_TOAST_ID,
              duration: Infinity,
            },
          );
          break;
        case "downloaded": {
          const version = event.info.version
            ? `v${event.info.version}`
            : t("updater.newVersion", "new version");
          toast.success(t("updater.ready", "Update ready to install"), {
            id: UPDATE_TOAST_ID,
            description: t("updater.restartToInstall", "Restart to install {{version}}.", {
              version,
            }),
            duration: Infinity,
            classNames: {
              content: "flex-1",
            },
            action: {
              label: t("updater.restart", "Restart"),
              onClick: () => {
                void electron.installUpdate().catch(showUpdaterActionError);
              },
            },
            cancel: {
              label: t("updater.later", "Later"),
              onClick: () => toast.dismiss(UPDATE_TOAST_ID),
            },
          });
          break;
        }
        case "disabled":
          if (event.manual) {
            toast.info(t("updater.disabled", "Updates are available only in packaged builds."), {
              id: UPDATE_TOAST_ID,
              duration: 4000,
            });
          }
          break;
        case "error":
          if (event.manual) {
            toast.error(event.message, {
              id: UPDATE_TOAST_ID,
              duration: 5000,
            });
          }
          break;
      }
    };
    void electron.getUpdaterStatus().then((event) => {
      if (event?.type === "available" || event?.type === "downloaded") {
        handleUpdaterEvent(event);
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
    <ErrorBoundary>
      <ThemeProvider>
        <MessageProvider>
          <HashRouter>
            <AppContent />
          </HashRouter>
        </MessageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
