import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { PermissionDialog } from "./permission-dialog";
import { useActiveSessionState, useAppStore } from "../store";
import { Badge } from "@/components/ui/badge";
import { formatSessionTime } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { request } from "../backend";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Chat() {
  const { t } = useTranslation();
  const { permissionRequests } = useActiveSessionState();
  const { sessions, activeSessionId } = useAppStore();
  const currentPermissionRequest = permissionRequests[0];
  const session = sessions.find((item) => item.id === activeSessionId) ?? null;

  const handleRefreshSession = async () => {
    if (!session) return;
    const {
      resetSessionState,
      setIsConnecting,
      pushGlobalErrorMessage,
      setAvailableModels,
      setCurrentModelId,
      setAvailableModes,
      setCurrentModeId,
    } = useAppStore.getState();

    resetSessionState(session.id);
    setIsConnecting(true);
    try {
      const result = (await request.loadSession({ sessionId: session.id })) as {
        sessionId: string;
        models: { availableModels: any[]; currentModelId: string } | null;
        modes: { availableModes: any[]; currentModeId: string } | null;
      } | null;
      if (!result) return;
      if (result.models) {
        setAvailableModels(result.models.availableModels);
        setCurrentModelId(result.models.currentModelId);
      } else {
        setAvailableModels([]);
        setCurrentModelId(null);
      }
      if (result.modes) {
        setAvailableModes(result.modes.availableModes);
        setCurrentModeId(result.modes.currentModeId);
      } else {
        setAvailableModes([]);
        setCurrentModeId(null);
      }
    } catch (err: unknown) {
      console.error("Failed to load session:", err);
      let message = "Failed to load session.";
      if (err instanceof Error && err.message.trim()) message = err.message.trim();
      else if (typeof err === "string" && err.trim()) message = err.trim();
      pushGlobalErrorMessage(message);
    } finally {
      setIsConnecting(false);
    }
  };

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
            <div className="ml-2 flex items-center shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors">
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32 py-1">
                  <DropdownMenuItem
                    className="text-xs rounded-1 text-muted-foreground/90"
                    onClick={handleRefreshSession}
                  >
                    <RefreshCw className="size-3" />
                    {t("chatHeader.refresh")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
