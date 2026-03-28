import { useEffect } from "react";
import { useAppStore, useActiveSessionState } from "./store";
import { rpc } from "./rpc";
import { processEvent } from "./lib/process-event";
import { Sidebar } from "./components/sidebar";
import { SessionView } from "./components/session-view";
import { PermissionDialog } from "./components/permission-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionInfo } from "./store";

function App() {
  const { addPermissionRequest, setSessions } = useAppStore();
  const { permissionRequests } = useActiveSessionState();

  useEffect(() => {
    rpc.listSessions().then((s: unknown) => {
      setSessions((s as SessionInfo[]) ?? []);
    });
  }, [setSessions]);

  useEffect(() => {
    const handleSessionUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const update = detail.update;
      const sid = useAppStore.getState().activeSessionId;
      if (!sid) return;
      processEvent(sid, update);
      rpc.saveEvent(sid, update);
    };

    const handlePermissionRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const sid = useAppStore.getState().activeSessionId;
      if (!sid) return;
      addPermissionRequest(sid, {
        toolCall: detail.toolCall,
        options: detail.options,
      });
    };

    window.addEventListener("acp:session-update", handleSessionUpdate);
    window.addEventListener("acp:permission-request", handlePermissionRequest);
    return () => {
      window.removeEventListener("acp:session-update", handleSessionUpdate);
      window.removeEventListener("acp:permission-request", handlePermissionRequest);
    };
  }, [addPermissionRequest]);

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <SessionView />
        {permissionRequests.map((req) => (
          <PermissionDialog key={req.toolCall.toolCallId} request={req} />
        ))}
      </div>
    </TooltipProvider>
  );
}

export default App;
