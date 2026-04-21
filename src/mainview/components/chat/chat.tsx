import { ChatArea } from "./chat-area";
import { ChatInput } from "./chat-input";
import { useAppStore } from "../../store";
import { Badge } from "@/components/ui/badge";
import { formatSessionTime, extractErrorMessage } from "@/lib/utils";
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

import type { SessionInfo } from "../../../shared/schema";
export function Chat({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);

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

  const handleToggleMcpServer = async (mcpId: string) => {
    if (!session) return;
    const { pushGlobalErrorMessage } = useAppStore.getState();
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
      pushGlobalErrorMessage(extractErrorMessage(err) || "Failed to update MCP servers");
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
                {formatSessionTime(session.updatedAt)}
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
                        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
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
