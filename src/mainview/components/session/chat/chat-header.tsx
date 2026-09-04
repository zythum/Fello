import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../../store";
import { Settings2, ReceiptTurkishLira, Copy, Check, FolderOpen, Loader2 } from "lucide-react";
import { cn, formatUpdatedTime, extractErrorMessage } from "@/lib/utils";
import { request, isWebUI } from "../../../backend";
import { electron } from "../../../electron";
import {
  closeSession,
  restartSession,
  RestartSessionError,
  SessionLifecycleBusyError,
} from "../../../lib/session-lifecycle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useMessage } from "../../providers/message";
import { copyText } from "@/lib/clipboard";
import type { SessionInfo, Feature } from "../../../../shared/schema";
import { ALL_FEATURES, FEATURE_I18N_KEYS } from "../../../../shared/constants";

interface ChatHeaderProps {
  session: SessionInfo;
}

export function ChatHeader({ session }: ChatHeaderProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const navigate = useNavigate();
  const configuredMcpServers = useAppStore((s) => s.configuredMcpServers);
  const projects = useAppStore((s) => s.projects);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  const currentProjectId = session.projectId;
  const currentProjectInfo = projects.find((project) => project.id === currentProjectId);

  // Local state: only used while the popover is open, synced from session on open
  const [localMcpServers, setLocalMcpServers] = useState<string[]>([]);
  const [localFeatures, setLocalFeatures] = useState<Feature[]>([]);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleToggle = useCallback((mcpId: string) => {
    setLocalMcpServers((prev) =>
      prev.includes(mcpId) ? prev.filter((id) => id !== mcpId) : [...prev, mcpId],
    );
  }, []);

  const handleSyncAndRefresh = async () => {
    if (!session || isClosing || isRestarting) return;
    setIsRestarting(true);
    try {
      await restartSession({
        session,
        mcpServers: localMcpServers,
        features: localFeatures,
      });
    } catch (err) {
      console.error("Failed to restart session:", err);
      if (err instanceof SessionLifecycleBusyError) {
        toast.error(
          t(
            "chatHeader.sessionOperationInProgress",
            "Another session operation is already in progress.",
          ),
        );
        return;
      }
      const lifecycleError = err instanceof RestartSessionError ? err : null;
      const cause = lifecycleError?.cause ?? err;
      const fallback =
        lifecycleError?.stage === "update"
          ? t("chat.failedToUpdateMcpServers", "Failed to update MCP servers")
          : t("chat.failedToLoadSession", "Failed to load session.");
      toast.error(extractErrorMessage(cause) || fallback);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleCloseSession = async () => {
    if (isClosing || isRestarting) return;
    setIsClosing(true);
    try {
      await closeSession(session.id);
      navigate("/");
    } catch (err) {
      console.error("Failed to close session:", err);
      if (err instanceof SessionLifecycleBusyError) {
        toast.error(
          t(
            "chatHeader.sessionOperationInProgress",
            "Another session operation is already in progress.",
          ),
        );
        return;
      }
      toast.error(
        extractErrorMessage(err) ||
          t("chatHeader.failedToCloseSession", "Failed to close session."),
      );
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div
      className={cn(
        "relative flex h-12 items-center border-b border-border gap-2 pr-2.5 bg-background shrink-0 transition-[padding] duration-200",
        sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
      )}
      style={{ WebkitAppRegion: "drag" }}
    >
      <Badge variant="outline" className="px-1 text-[10px] uppercase select-none">
        {session.agentId}
      </Badge>
      <div className="flex flex-1 min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
          {session.title || t("sidebar.newSession", "New Session")}
        </span>
        <span className="flex-1 text-[10px] text-muted-foreground truncate">
          {currentProjectInfo?.cwd}
        </span>
        <span className="shrink-0 text-xs text-sidebar-foreground/70 whitespace-nowrap">
          {formatUpdatedTime(session.updatedAt)}
        </span>
      </div>
      <div className="ml-1 flex items-center shrink-0 gap-1" style={{ WebkitAppRegion: "no-drag" }}>
        <UsageButton session={session} />
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
              <PopoverPrimitive.Popup className="z-10 w-110 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none p-1.5 origin-(--transform-origin) data-ending-style:scale-90 data-starting-style:scale-90 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-[transform,opacity] duration-100">
                <div className="space-y-1 py-1">
                  {/* Session */}
                  <div className="px-2">
                    <CopyableRow
                      label={t("chatHeader.sessionId", "Session")}
                      value={session.id}
                      openFolderTitle={t("chatHeader.openSessionFolder", "Open Session Folder")}
                      onOpenFolder={async () => {
                        const dirPath = await request.getSessionDataSystemPath({
                          sessionId: session.id,
                        });
                        if (dirPath) electron.revealInFinder(dirPath);
                      }}
                    />
                  </div>

                  {/* Project */}
                  <div className="px-2">
                    <CopyableRow
                      label={t("chatHeader.projectId", "Project")}
                      value={currentProjectInfo?.cwd ?? session.projectTitle}
                      openFolderTitle={t("chatHeader.openProjectFolder", "Open Project Folder")}
                      onOpenFolder={async () => {
                        const dirPath = currentProjectInfo?.cwd;
                        if (dirPath) electron.revealInFinder(dirPath);
                      }}
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-border/50 my-1" />

                {/* Features toggles */}
                <div className="px-2 py-1 text-xs font-semibold text-foreground/80">
                  {t("constant.feature.title", "Features")}
                </div>
                <div className={ALL_FEATURES.length >= 2 ? "grid grid-cols-2 gap-0.5" : ""}>
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
                      className={configuredMcpServers.length >= 2 ? "grid grid-cols-2 gap-0.5" : ""}
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

                <div className="mt-1 flex gap-1">
                  <Button
                    size="xs"
                    className="flex flex-3 items-center gap-2 h-7 text-xs font-normal"
                    onClick={handleSyncAndRefresh}
                    disabled={isClosing || isRestarting}
                  >
                    {isRestarting && <Loader2 className="size-3 animate-spin" />}
                    <span>{t("chatHeader.refresh", "Restart Session")}</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    className="flex flex-1 items-center gap-1.5 h-7 text-xs font-normal"
                    onClick={handleCloseSession}
                    disabled={isClosing || isRestarting}
                  >
                    {isClosing && <Loader2 className="size-3 animate-spin" />}
                    <span>
                      {isClosing
                        ? t("chatHeader.closingSession", "Closing…")
                        : t("chatHeader.closeSession", "Close Session")}
                    </span>
                  </Button>
                </div>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  );
}

function UsageButton({ session }: Pick<ChatHeaderProps, "session">) {
  const { t } = useTranslation();
  const configuredAgents = useAppStore((s) => s.configuredAgents);
  const { lastTurnUsage, usage } = session;
  const isApiAgent = configuredAgents.some(
    (agent) => agent.id === session.agentId && agent.type === "api",
  );

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
              {/* View Breakdown button */}
              {isApiAgent && (
                <PopoverPrimitive.Close
                  className={buttonVariants({
                    variant: "outline",
                    size: "xs",
                    className: "w-full py-3 font-normal border-border!",
                  })}
                  onClick={() => {
                    document.dispatchEvent(new CustomEvent("fello-open-token-usage"));
                  }}
                >
                  {t("chatHeader.viewBreakdown", "View Breakdown")}
                </PopoverPrimitive.Close>
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

function CopyableRow({
  label,
  value,
  onOpenFolder,
  openFolderTitle,
}: {
  label: string;
  value: string;
  onOpenFolder?: () => void;
  openFolderTitle?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground w-12">{label}:</span>
      <span className="flex-1 min-w-0 truncate font-mono text-muted-foreground/70 select-all">
        {value}
      </span>
      <button
        type="button"
        className="shrink-0 flex items-center justify-center size-5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors -mr-1"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
      {!isWebUI && onOpenFolder && (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center size-5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors -mr-1"
          onClick={onOpenFolder}
          title={openFolderTitle}
        >
          <FolderOpen className="size-3" />
        </button>
      )}
    </div>
  );
}
