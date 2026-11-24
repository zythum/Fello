import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../../store";
import { Settings2, Loader2, PanelRightOpen, Download, FolderOpen } from "lucide-react";
import { cn, extractErrorMessage } from "@/lib/utils";
import { request, isWebUI } from "../../../backend";
import { electron } from "../../../electron";
import {
  closeSession,
  restartSession,
  RestartSessionError,
  SessionLifecycleBusyError,
} from "../../../lib/session-lifecycle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useMessage } from "../../providers/message";
import { SessionConfigFields } from "@/components/common/session-config";
import { CopyableRow } from "../../common/copyable-row";
import { TtsMenuButton, TtsReadoutButton } from "../../common/tts-header-controls";
import { UsageButton } from "../../common/usage-button";
import type { SessionInfo, Feature } from "../../../../shared/schema";

interface ChatHeaderProps {
  session: SessionInfo;
}

function ChatHeaderImpl({ session }: ChatHeaderProps) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const setPanelOpen = useAppStore((s) => s.setPanelOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = isMacApp && !isFullScreen;

  const currentProjectId = session.projectId;
  const currentProjectInfo = projects.find((project) => project.id === currentProjectId);
  // 项目名优先取 store 里的最新标题（重命名后立刻生效），兜底用会话快照。
  const projectName = currentProjectInfo?.title || session.projectTitle;
  const projectCwd = currentProjectInfo?.cwd ?? session.cwd;

  const handleRevealProjectFolder = useCallback(async () => {
    if (!projectCwd) return;
    try {
      await electron.revealInFinder(projectCwd);
    } catch (err) {
      toast.error(
        extractErrorMessage(err) ||
          t("chatHeader.failedToRevealProject", "Failed to reveal project in Finder."),
      );
    }
  }, [projectCwd, t, toast]);

  // Local state: only used while the popover is open, synced from session on open
  const [localMcpServers, setLocalMcpServers] = useState<string[]>([]);
  const [localFeatures, setLocalFeatures] = useState<Feature[]>([]);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handlePermissionChange = useCallback(
    async (permissionMode: SessionInfo["permissionMode"]) => {
      try {
        await request.updateSession({ sessionId: session.id, permissionMode });
      } catch (err) {
        console.error("Failed to update session permission:", err);
        toast.error(
          extractErrorMessage(err) ||
            t("chatHeader.failedToUpdatePermission", "Failed to update permission."),
        );
      }
    },
    [session.id, t, toast],
  );

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

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const { filename, json } = await request.exportSession({ sessionId: session.id });
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Let the download start before revoking the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Failed to export session:", err);
      toast.error(
        extractErrorMessage(err) ||
          t("chatHeader.failedToExportSession", "Failed to export conversation."),
      );
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, session.id, t, toast]);

  // 图标与项目名一起作为可点区域（WebUI 下退化为纯文本）。
  const projectLabel = (
    <>
      <FolderOpen aria-hidden="true" className="size-3 shrink-0 self-center" />
      <span className="truncate">{projectName}</span>
    </>
  );

  return (
    <div
      className={cn(
        "relative flex h-12 items-center border-b border-border gap-2 pr-2.5 bg-background shrink-0 transition-[padding] duration-200",
        sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
      )}
      style={{ WebkitAppRegion: "drag" }}
    >
      <Badge variant="outline" className="px-1 text-[9px] uppercase select-none">
        {session.agentId}
      </Badge>
      <div className="flex flex-1 min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-normal text-sidebar-foreground/85">
          {session.title || t("sidebar.newSession", "New Session")}
        </span>
        {projectName &&
          (isWebUI ? (
            <span className="flex min-w-0 shrink items-baseline gap-1 text-[11px] text-sidebar-foreground/45">
              {projectLabel}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleRevealProjectFolder()}
              title={projectCwd}
              style={{ WebkitAppRegion: "no-drag" }}
              className="flex min-w-0 shrink cursor-default items-baseline gap-1 text-left text-[11px] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/80"
            >
              {projectLabel}
            </button>
          ))}
      </div>
      <div className="ml-1 flex items-center shrink-0 gap-1" style={{ WebkitAppRegion: "no-drag" }}>
        <TtsReadoutButton />
        <TtsMenuButton />
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
                <div className="space-y-px py-1">
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

                {/* 权限 / features / MCP servers（与加载失败页共用同一实现） */}
                <SessionConfigFields
                  variant="popover"
                  permissionMode={session.permissionMode}
                  onPermissionModeChange={(mode) => void handlePermissionChange(mode)}
                  features={localFeatures}
                  onFeaturesChange={setLocalFeatures}
                  mcpServers={localMcpServers}
                  onMcpServersChange={setLocalMcpServers}
                />

                <div className="mt-1 flex gap-1">
                  <Button
                    size="xs"
                    variant="destructive"
                    className="flex min-w-30 items-center gap-1.5 h-7 text-xs font-normal"
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
                  <div className="flex-1"></div>
                  <Button
                    size="xs"
                    className="flex min-w-30 items-center gap-2 h-7 text-xs font-normal"
                    onClick={handleSyncAndRefresh}
                    disabled={isClosing || isRestarting}
                  >
                    {isRestarting && <Loader2 className="size-3 animate-spin" />}
                    <span>{t("chatHeader.refresh", "Restart Session")}</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="size-7 shrink-0"
                    onClick={() => void handleExport()}
                    disabled={isClosing || isRestarting || isExporting}
                    title={t("chatHeader.exportSession", "Export conversation (JSON)")}
                    aria-label={t("chatHeader.exportSession", "Export conversation (JSON)")}
                  >
                    {isExporting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                  </Button>
                </div>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        {!panelOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPanelOpen(true)}
            title={t("panel.expand", "Expand panel")}
            aria-label={t("panel.expand", "Expand panel")}
            className="text-sidebar-foreground/45 hover:text-sidebar-foreground/70"
          >
            <PanelRightOpen className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export const ChatHeader = memo(ChatHeaderImpl);
