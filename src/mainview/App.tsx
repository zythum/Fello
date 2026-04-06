import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "./store";
import { request, subscribe } from "./backend";
import { processEvent } from "./lib/process-event";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectInfo, SessionInfo } from "./store";
import { MessageProvider, useMessage } from "@/components/message";

function AppContent() {
  const {
    addPermissionRequest,
    setSessions,
    setProjects,
    globalErrorMessages,
    shiftGlobalErrorMessage,
    setConfiguredAgents,
    setTheme,
    setLanguage,
  } = useAppStore();
  const { i18n } = useTranslation();
  const { alert } = useMessage();
  const currentGlobalError = globalErrorMessages[0] ?? null;

  useEffect(() => {
    async function loadData() {
      const [projects, sessions, settings] = await Promise.all([
        request.listProjects(),
        request.listSessions(),
        request.getSettings(),
      ]);
      setProjects((projects as ProjectInfo[]) ?? []);
      setSessions((sessions as SessionInfo[]) ?? []);
      setConfiguredAgents(settings.agents);
      if (settings.theme) setTheme(settings.theme);
      if (settings.language) {
        setLanguage(settings.language);
        i18n.changeLanguage(settings.language);
      }
    }
    void loadData();
  }, [setProjects, setSessions, setConfiguredAgents, setTheme, setLanguage, i18n]);

  useEffect(() => {
    const handleSessionUpdate = (detail: any) => {
      const sessions = useAppStore.getState().sessions;
      const targetSession = sessions.find((s) => s.acp_session_id === detail.sessionId);
      const sid = targetSession ? targetSession.id : useAppStore.getState().activeSessionId;
      if (!sid) return;
      processEvent(sid, detail.update);
    };

    const handlePermissionRequest = (detail: any) => {
      const sid = useAppStore.getState().activeSessionId;
      if (!sid) return;
      addPermissionRequest(sid, {
        toolCall: detail.toolCall,
        options: detail.options,
      });
    };

    const handleAgentTerminalOutput = (detail: any) => {
      useAppStore.getState().appendTerminalLog(detail.terminalId, detail.data);
    };

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("permission-request", handlePermissionRequest);
    subscribe.on("agent-terminal-output", handleAgentTerminalOutput);
    return () => {
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("permission-request", handlePermissionRequest);
      subscribe.off("agent-terminal-output", handleAgentTerminalOutput);
    };
  }, [addPermissionRequest]);

  useEffect(() => {
    if (!currentGlobalError) return;

    const showError = async () => {
      await alert({
        title: "Error",
        content: currentGlobalError,
      });
      shiftGlobalErrorMessage();
    };

    void showError();
  }, [currentGlobalError, alert, shiftGlobalErrorMessage]);

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
