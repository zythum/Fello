import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { request } from "../../../backend";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../../lib/session-state-reducer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
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

  // Local state: only used while the popover is open, synced from session on open
  const [localMcpServers, setLocalMcpServers] = useState<string[]>([]);

  // Check whether the local selection differs from what the session currently has
  const hasLocalChanges = useMemo(() => {
    const local = new Set(localMcpServers);
    const sessionIds = new Set(session.mcpServers || []);
    if (local.size !== sessionIds.size) return true;
    for (const id of local) {
      if (!sessionIds.has(id)) return true;
    }
    return false;
  }, [localMcpServers, session.mcpServers]);

  const handleToggle = useCallback((mcpId: string) => {
    setLocalMcpServers((prev) =>
      prev.includes(mcpId) ? prev.filter((id) => id !== mcpId) : [...prev, mcpId],
    );
  }, []);

  const handleSyncAndRefresh = async () => {
    if (!session) return;
    try {
      await request.updateSessionMcpServers({
        sessionId: session.id,
        mcpServers: localMcpServers,
      });
    } catch (err) {
      console.error("Failed to update MCP servers:", err);
      toast.error(
        extractErrorMessage(err) ||
          t("chat.failedToUpdateMcpServers", "Failed to update MCP servers"),
      );
      return;
    }

    // Refresh session history
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

  return (
    <div
      className="relative flex h-12 items-center border-b border-border gap-2 pl-2.5 pr-2.5 bg-background shrink-0"
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
        <PopoverPrimitive.Root
          onOpenChange={(open) => {
            if (open) {
              // Sync local state from session whenever popover opens
              setLocalMcpServers(session.mcpServers || []);
            }
          }}
        >
          <PopoverPrimitive.Trigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors data-pressed:bg-sidebar-accent/40">
            <MoreHorizontal className="size-4" />
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
              <PopoverPrimitive.Popup className="z-10 min-w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none p-1.5 origin-[var(--transform-origin)] data-[ending-style]:scale-90 data-[starting-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-[transform,opacity] duration-100">
                {/* MCP server toggles */}
                {configuredMcpServers.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[10px] font-normal text-muted-foreground/70">
                      {t("settings.mcp.title", "MCP Servers")}
                    </div>
                    {configuredMcpServers.map((mcp) => (
                      <div
                        key={mcp.id}
                        className="flex items-center justify-between rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                        onClick={() => handleToggle(mcp.id)}
                      >
                        <span className="truncate mr-2">{mcp.id}</span>
                        <Switch
                          size="sm"
                          checked={localMcpServers.includes(mcp.id)}
                          onCheckedChange={() => handleToggle(mcp.id)}
                        />
                      </div>
                    ))}
                  </>
                )}

                {/* Refresh — only enabled when local state differs from session */}
                <Button
                  size="sm"
                  disabled={!hasLocalChanges}
                  className="flex w-full items-center gap-2 h-8 mt-1 text-xs"
                  onClick={hasLocalChanges ? handleSyncAndRefresh : undefined}
                >
                  <RefreshCw className="size-3.5 shrink-0" />
                  <span>{t("chatHeader.refresh", "Refresh")}</span>
                </Button>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  );
}
