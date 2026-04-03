import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { PermissionDialog } from "./permission-dialog";
import { useActiveSessionState, useAppStore } from "../store";
import { Badge } from "@/components/ui/badge";
import { formatSessionTime } from "@/lib/utils";

export function Chat() {
  const { permissionRequests } = useActiveSessionState();
  const { sessions, activeSessionId } = useAppStore();
  const currentPermissionRequest = permissionRequests[0];
  const session = sessions.find((item) => item.id === activeSessionId) ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-sidebar">
      {session && (
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <div className="min-w-0 flex flex-1">
            <div className="flex flex-1 min-w-0 items-center gap-1.5">
              <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
                {session.agent}
              </Badge>
              <span className="truncate text-sm font-medium text-sidebar-foreground/85">
                {session.title}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/60 whitespace-nowrap">
                {formatSessionTime(session.updated_at)}
              </span>
            </div>
          </div>
        </div>
      )}
      <ChatArea />
      <ChatInput />
      {currentPermissionRequest && (
        <PermissionDialog
          key={currentPermissionRequest.toolCall.toolCallId}
          request={currentPermissionRequest}
        />
      )}
    </div>
  );
}
