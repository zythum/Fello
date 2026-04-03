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
import type { SessionInfo } from "./store";

function App() {
  const {
    addPermissionRequest,
    setSessions,
    globalErrorMessages,
    shiftGlobalErrorMessage,
  } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibleGlobalError, setVisibleGlobalError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentGlobalError = globalErrorMessages[0] ?? null;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    request.listSessions().then((s: unknown) => {
      setSessions((s as SessionInfo[]) ?? []);
    });
  }, [setSessions]);

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
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseErrorDialog();
        }}
      >
        <DialogContent>
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
