import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionUsage } from "../../../lib/session-selectors";
import { useAppStore } from "../../../store";
import { Settings2, ReceiptTurkishLira } from "lucide-react";
import { cn, formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { request } from "../../../backend";
import { reduceFlushStreaming, reduceSessionUpdate } from "../../../lib/session-state-reducer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useMessage } from "../../providers/message";
import type { SessionInfo, Feature } from "../../../../shared/schema";
import { ALL_FEATURES, FEATURE_I18N_KEYS } from "../../../../shared/constants";

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
  const [localFeatures, setLocalFeatures] = useState<Feature[]>([]);

  const handleToggle = useCallback((mcpId: string) => {
    setLocalMcpServers((prev) =>
      prev.includes(mcpId) ? prev.filter((id) => id !== mcpId) : [...prev, mcpId],
    );
  }, []);

  const handleSyncAndRefresh = async () => {
    if (!session) return;
    try {
      await request.updateSession({
        sessionId: session.id,
        mcpServers: localMcpServers,
        features: localFeatures,
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
    const { resetSessionState, updateSessionState, updateSession } = useAppStore.getState();
    try {
      updateSession({ ...session, isStreaming: false });
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

      state.pendingUpdates = [];
      state.isLoading = false;

      updateSessionState(session.id, () => state);

      request.loadSession({ sessionId: session.id, force: true }).catch((err) => {
        console.error("Failed to load session:", err);
        toast.error(
          extractErrorMessage(err) || t("chat.failedToLoadSession", "Failed to load session."),
        );
      });
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
        <UsageButton sessionId={session.id} />
        <PopoverPrimitive.Root
          onOpenChange={(open) => {
            if (open) {
              // Sync local state from session whenever popover opens
              setLocalMcpServers(session.mcpServers);
              setLocalFeatures(session.features);
            }
          }}
        >
          <PopoverPrimitive.Trigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors data-pressed:bg-sidebar-accent/40">
            <Settings2 className="size-4" />
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
              <PopoverPrimitive.Popup className="z-10 min-w-96 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none p-1.5 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
                {/* Features toggles */}
                <div className="px-2 py-1 text-xs font-semibold text-foreground/80">
                  {t("constant.feature.title", "Features")}
                </div>
                <div
                  className={
                    ALL_FEATURES.length >= 2
                      ? "grid grid-cols-2 gap-0.5"
                      : ""
                  }
                >
                  {ALL_FEATURES.map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors cursor-default"
                      onClick={() =>
                        setLocalFeatures((prev) =>
                          prev.includes(feature)
                            ? prev.filter((f) => f !== feature)
                            : [...prev, feature],
                        )
                      }
                    >
                      <span
                        className={cn(
                          "truncate mr-2",
                          localFeatures.includes(feature)
                            ? "text-muted-foreground"
                            : "text-muted-foreground/50",
                        )}
                      >
                        {t(FEATURE_I18N_KEYS[feature], feature)}
                      </span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          size="sm"
                          checked={localFeatures.includes(feature)}
                          onCheckedChange={(checked) => {
                            setLocalFeatures((prev) =>
                              checked ? [...prev, feature] : prev.filter((f) => f !== feature),
                            );
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div className="border-t border-border/50 my-1" />

                {/* MCP server toggles */}
                {configuredMcpServers.length > 0 && (
                  <>
                    <div className="px-2 py-1 mt-1 text-xs font-semibold text-foreground/80">
                      {t("settings.mcp.title", "MCP Servers")}
                    </div>
                    <div
                      className={
                        configuredMcpServers.length >= 2
                          ? "grid grid-cols-2 gap-0.5"
                          : ""
                      }
                    >
                      {configuredMcpServers.map((mcp) => (
                        <div
                          key={mcp.id}
                          className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors cursor-default"
                          onClick={() => handleToggle(mcp.id)}
                        >
                          <span
                            className={cn(
                              "truncate mr-2",
                              localMcpServers.includes(mcp.id)
                                ? "text-muted-foreground"
                                : "text-muted-foreground/50",
                            )}
                          >
                            {mcp.id}
                          </span>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              size="sm"
                              checked={localMcpServers.includes(mcp.id)}
                              onCheckedChange={() => handleToggle(mcp.id)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* 重启会话：始终可点，清空 store 缓存并从 backend 重新拉取 */}
                <Button
                  size="xs"
                  className="flex w-full items-center gap-2 h-7 mt-1 text-xs font-normal"
                  onClick={handleSyncAndRefresh}
                >
                  <span>{t("chatHeader.refresh", "Restart Session")}</span>
                </Button>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  );
}

function UsageButton({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const { lastTurnUsage, usage } = useSessionUsage(sessionId);
  const hasData = usage || lastTurnUsage;

  if (!hasData) return null;

  const pct = usage?.size ? (usage.used / usage.size) * 100 : 0;
  const pctColor = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-primary";

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/70 outline-none transition-colors data-pressed:bg-sidebar-accent/40">
        <ReceiptTurkishLira className="size-4" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4}>
          <PopoverPrimitive.Popup className="z-10 w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none p-4 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
            <div className="space-y-4 text-xs">
              {/* Context window */}
              {usage && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-foreground/80">
                      {t("chatHeader.contextWindow")}
                    </span>
                    {usage.size > 1 ? (
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {usage.used.toLocaleString()} / {usage.size.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pctColor}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/60">
                    <span>{t("chatHeader.percentUsed", { pct: pct.toFixed(2) })}</span>
                    {usage.size > 1 ? (
                      <span>
                        {t("chatHeader.remaining", {
                          count: (usage.size - usage.used).toLocaleString(),
                        })}
                      </span>
                    ) : null}
                  </div>
                  {/* Cost */}
                  {usage.cost && (
                    <div className="mt-2 flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{t("chatHeader.cost")}</span>
                      <span className="font-mono tabular-nums text-foreground/80">
                        {usage.cost.amount} {usage.cost.currency}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Last turn usage */}
              {lastTurnUsage && (
                <div>
                  <div className="border-t border-border/50 pt-3">
                    <div className="font-semibold text-foreground/80 mb-2">
                      {t("chatHeader.lastTurn")}
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <Row label={t("chatHeader.input")} value={lastTurnUsage.inputTokens} />
                      <Row label={t("chatHeader.output")} value={lastTurnUsage.outputTokens} />
                      <Row label={t("chatHeader.total")} value={lastTurnUsage.totalTokens} bold />
                      {lastTurnUsage.thoughtTokens != null && (
                        <Row label={t("chatHeader.thought")} value={lastTurnUsage.thoughtTokens} />
                      )}
                      {lastTurnUsage.cachedReadTokens != null && (
                        <Row
                          label={t("chatHeader.cacheRead")}
                          value={lastTurnUsage.cachedReadTokens}
                        />
                      )}
                      {lastTurnUsage.cachedWriteTokens != null && (
                        <Row
                          label={t("chatHeader.cacheWrite")}
                          value={lastTurnUsage.cachedWriteTokens}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${bold ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
