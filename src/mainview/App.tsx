import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "./store";
import { request, subscribe, BackendEvents } from "./backend";
import { reduceSessionUpdate } from "./lib/session-state-reducer";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageProvider, useMessage } from "@/components/message";

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
  const { alert } = useMessage();
  const currentGlobalError = globalErrorMessages[0] ?? null;
  const [isReady, setIsReady] = useState(false);

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
    const handleSessionUpdate = (detail: BackendEvents["session-update"]) => {
      const sessions = useAppStore.getState().sessions;
      const targetSession = sessions.find((s) => s.id === detail.sessionId);
      const sid = targetSession ? targetSession.id : useAppStore.getState().activeSessionId;
      if (!sid) return;
      const currentState = useAppStore.getState().getSessionState(sid);
      const nextState = reduceSessionUpdate(currentState, detail.notification.update);

      if (nextState !== currentState) {
        useAppStore.getState().updateSessionState(sid, () => nextState);
      }
    };

    const handlePermissionRequest = (detail: BackendEvents["permission-request"]) => {
      const sid = useAppStore.getState().activeSessionId;
      if (!sid) return;
      useAppStore.getState().addPermissionRequest(sid, detail.request);
    };

    const handleAgentTerminalOutput = (detail: BackendEvents["agent-terminal-output"]) => {
      useAppStore.getState().appendTerminalLog(detail.terminalId, detail.data);
    };

    const handleWebUIStatusChanged = (detail: BackendEvents["webui-status-changed"]) => {
      useAppStore.getState().setWebUIStatus(detail.status);
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("permission-request", handlePermissionRequest);
    subscribe.on("agent-terminal-output", handleAgentTerminalOutput);
    subscribe.on("webui-status-changed", handleWebUIStatusChanged);
    return () => {
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("permission-request", handlePermissionRequest);
      subscribe.off("agent-terminal-output", handleAgentTerminalOutput);
      subscribe.off("webui-status-changed", handleWebUIStatusChanged);
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
      </div>
    </TooltipProvider>
  );
}

function App() {
  return (
    <MessageProvider>
      <AppContent />
    </MessageProvider>
  );
}

export default App;
