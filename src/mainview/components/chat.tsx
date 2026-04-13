import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { PermissionDialog } from "./permission-dialog";
import { useActiveSessionState, useAppStore } from "../store";
import { Badge } from "@/components/ui/badge";
import { formatSessionTime, extractErrorMessage } from "@/lib/utils";
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
    const { resetSessionState, pushGlobalErrorMessage, updateSessionState } =
      useAppStore.getState();

    try {
      resetSessionState(session.id);
      updateSessionState(session.id, () => ({ isLoading: true }));
      const result = await request.loadSession({ sessionId: session.id });
      if (!result) return;
      updateSessionState(session.id, (prev) => ({
        ...prev,
        agentInfo: result.agentInfo ?? null,
        availableModels: result.models?.availableModels ?? [],
        currentModelId: result.models?.currentModelId ?? null,
        availableModes: result.modes?.availableModes ?? [],
        currentModeId: result.modes?.currentModeId ?? null,
        isStreaming: result.isStreaming,
      }));
    } catch (err) {
      console.error("Failed to load session:", err);
      const message =
        extractErrorMessage(err) || t("chat.failedToLoadSession", "Failed to load session.");
      pushGlobalErrorMessage(message);
    } finally {
      updateSessionState(session.id, () => ({ isLoading: false }));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {session && (
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <div className="min-w-0 flex flex-1">
            <div className="flex flex-1 min-w-0 items-center gap-1.5">
              <Badge variant="outline" className="px-1 text-[10px] uppercase">
                {session.agentId}
              </Badge>
              <span className="truncate text-sm font-normal text-sidebar-foreground/85">
                {session.title}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/60 whitespace-nowrap">
                {formatSessionTime(session.updatedAt)}
              </span>
            </div>
            <div className="ml-2 flex items-center shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors">
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32">
                  <DropdownMenuItem onClick={handleRefreshSession}>
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
