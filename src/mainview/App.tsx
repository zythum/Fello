import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "./store";
import { request, subscribe } from "./backend";
import { processEvent } from "./lib/process-event";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectInfo, SessionInfo } from "./store";

function App() {
  const {
    addPermissionRequest,
    setSessions,
    setProjects,
    globalErrorMessages,
    shiftGlobalErrorMessage,
    setConfiguredAgents,
    setTheme,
  } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibleGlobalError, setVisibleGlobalError] = useState<string | null>(null);
  const [errorDialogKey, setErrorDialogKey] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentGlobalError = globalErrorMessages[0] ?? null;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

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
    }
    void loadData();
  }, [setProjects, setSessions, setConfiguredAgents, setTheme]);

  useEffect(() => {
    const handleSessionUpdate = (detail: any) => {
      const sid = useAppStore.getState().activeSessionId;
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

    subscribe.on("session-update", handleSessionUpdate);
    subscribe.on("permission-request", handlePermissionRequest);
    return () => {
      subscribe.off("session-update", handleSessionUpdate);
      subscribe.off("permission-request", handlePermissionRequest);
    };
  }, [addPermissionRequest]);

  useEffect(() => {
    if (visibleGlobalError || !currentGlobalError) return;
    setErrorDialogKey((key) => key + 1);
    setVisibleGlobalError(currentGlobalError);
    setDialogOpen(true);
  }, [currentGlobalError, visibleGlobalError]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  const handleCloseErrorDialog = useCallback(() => {
    if (!visibleGlobalError) return;
    setDialogOpen(false);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      shiftGlobalErrorMessage();
      setVisibleGlobalError(null);
      closeTimerRef.current = null;
    }, 120);
  }, [clearCloseTimer, shiftGlobalErrorMessage, visibleGlobalError]);

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <SessionView />
      </div>
      <Dialog
        key={errorDialogKey}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) setDialogOpen(true);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>{visibleGlobalError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={handleCloseErrorDialog}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export default App;
