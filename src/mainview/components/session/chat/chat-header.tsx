import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { request } from "../../../backend";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../../lib/session-state-reducer";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useMessage } from "../../providers/message";
import type { SessionInfo } from "../../../../shared/schema";

interface ChatHeaderProps {
  session: SessionInfo;
}

export function ChatHeader({ session }: ChatHeaderProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = session.projectId;
  const currentProjectInfo = projects.find((project) => project.id === currentProjectId);

  const handleRefreshSession = async () => {
    if (!session) return;
    const { resetSessionState, updateSessionState } = useAppStore.getState();
    try {
      updateSessionState(session.id, (prev) => reduceFlushStreaming(prev));
      resetSessionState(session.id);
      updateSessionState(session.id, () => ({ isLoading: true }));
      const result = await request.getSessionHistory({ sessionId: session.id });
      if (!result) return;

      let state = useAppStore.getState().getSessionState(session.id);
      state = { ...state, messages: [], activeToolCalls: new Map() };
      for (const notification of result.messages) {
        if (!notification?.update) continue;
        state = reduceSessionUpdate(state, notification.update);
      }

      const displayIds = new Set(
        result.messages.map((m) => m?.update?._meta?.fello?.displayId).filter(Boolean),
      );
      for (const update of state.pendingUpdates) {
        const did = update._meta?.fello?.displayId;
        if (did && displayIds.has(did)) continue;
        state = reduceSessionUpdate(state, update);
      }

      state.isStreaming = result.isStreaming;
      state.pendingUpdates = [];
      state.isLoading = false;

      updateSessionState(session.id, () => state);

      request.loadSession({ sessionId: session.id }).catch(console.error);
    } catch (err) {
      console.error("Failed to load session:", err);
      const message =
        extractErrorMessage(err) || t("chat.failedToLoadSession", "Failed to load session.");
      toast.error(message);
    } finally {
      useAppStore.getState().updateSessionState(session.id, () => ({ isLoading: false }));
    }
  };

  const handleToggleMcpServer = useCallback(
    async (mcpId: string) => {
      if (!session) return;
      const currentMcpServers = session.mcpServers || [];
      const newMcpServers = currentMcpServers.includes(mcpId)
        ? currentMcpServers.filter((id) => id !== mcpId)
        : [...currentMcpServers, mcpId];
      try {
        await request.updateSessionMcpServers({
          sessionId: session.id,
          mcpServers: newMcpServers,
        });
      } catch (err) {
        console.error("Failed to update MCP servers:", err);
        toast.error(
          extractErrorMessage(err) ||
            t("chat.failedToUpdateMcpServers", "Failed to update MCP servers"),
        );
      }
    },
    [session, t, toast],
  );

  return (
    <div
      className="relative z-30 flex h-12 items-center border-b border-border gap-2 pl-2.5 pr-2.5 bg-background shrink-0"
      style={{ WebkitAppRegion: "drag" }}
    >
      <Badge variant="outline" className="px-1 text-[10px] uppercase select-none">
        {session.agentId}
      </Badge>
      <div className="flex flex-1 min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
          {session.title || t("sidebar.newChat", "New Chat")}
        </span>
        <span className="flex-1 text-[10px] text-muted-foreground truncate">
          {currentProjectInfo?.cwd}
        </span>
        <span className="shrink-0 text-xs text-sidebar-foreground/70 whitespace-nowrap">
          {formatUpdatedTime(session.updatedAt)}
        </span>
      </div>
      <div className="ml-1 flex items-center shrink-0 gap-1" style={{ WebkitAppRegion: "no-drag" }}>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {configuredMcpServers.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[10px] font-semibold text-muted-foreground">
                    {t("settings.mcp.title", "MCP Servers")}
                  </DropdownMenuLabel>
                  {configuredMcpServers.map((mcp) => (
                    <DropdownMenuCheckboxItem
                      key={mcp.id}
                      className="text-xs"
                      checked={(session.mcpServers || []).includes(mcp.id)}
                      onCheckedChange={() => handleToggleMcpServer(mcp.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {mcp.id}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleRefreshSession}>
              <RefreshCw className="size-3" />
              {t("chatHeader.refresh", "Refresh")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
