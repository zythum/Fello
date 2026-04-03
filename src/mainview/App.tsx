import { useEffect } from "react";
import { useAppStore } from "./store";
import { request, subscribe } from "./backend";
import { processEvent } from "./lib/process-event";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionInfo } from "./store";

function App() {
  const { addPermissionRequest, setSessions } = useAppStore();

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

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <SessionView />
      </div>
    </TooltipProvider>
  );
}

export default App;
