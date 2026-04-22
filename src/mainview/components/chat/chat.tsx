import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { useAppStore } from "../../store";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../lib/session-state-reducer";
import { Badge } from "@/components/ui/badge";
import { formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { request } from "../../backend";
import { MoreHorizontal, RefreshCw } from "lucide-react";
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
import { useMessage } from "../providers/message";

import type { SessionInfo } from "../../../shared/schema";
export function Chat({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
  const { toast } = useMessage();

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

      // Warm up bridge silently
      request.loadSession({ sessionId: session.id }).catch(console.error);
    } catch (err) {
      console.error("Failed to load session:", err);
      const message =
        extractErrorMessage(err) || t("chat.failedToLoadSession", "Failed to load session.");
      toast.error(message);
    } finally {
      updateSessionState(session.id, () => ({ isLoading: false }));
    }
  };

  const handleToggleMcpServer = async (mcpId: string) => {
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
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {session ? (
        <div
          className="flex h-12 shrink-0 items-center border-b border-border px-3"
          style={{ WebkitAppRegion: "drag" }}
        >
          <div className="min-w-0 flex flex-1">
            <div className="flex flex-1 min-w-0 items-center gap-1.5">
              <Badge variant="outline" className="px-1 text-[10px] uppercase select-none">
                {session.agentId}
              </Badge>
              <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
                {session.title || t("sidebar.newChat", "New Chat")}
              </span>
              <span className="ml-auto shrink-0 text-xs text-sidebar-foreground/85 whitespace-nowrap">
                {formatUpdatedTime(session.updatedAt)}
              </span>
            </div>
            <div className="ml-2 flex items-center shrink-0" style={{ WebkitAppRegion: "no-drag" }}>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors">
                  <MoreHorizontal className="size-3.5" />
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
                    {t("chatHeader.refresh")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-12 px-3" style={{ WebkitAppRegion: "drag" }} />
      )}
      <ChatArea session={session} />
      <ChatInput session={session} />
    </div>
  );
}
