import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { Chat } from "./chat/chat";
import { Detail, type DetailType } from "./detail/detail";
import { Panel, type PanelTab } from "./panel/panel";
import { Loader2, RotateCw, TriangleAlert } from "lucide-react";
import {
  loadSession,
  restartSession,
  RestartSessionError,
  SessionLifecycleBusyError,
} from "../../lib/session-lifecycle";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { SessionConfigFields } from "../common/session-config";
import { extractErrorMessage } from "@/lib/utils";
import type { SessionInfo } from "../../../shared/schema";
import { useMessage } from "../providers/message";

export { type PanelTab } from "./panel/panel";

export function Session({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const sessionId = session.id;
  const sessionConnected = session.connectionStatus;
  const isCreatingSession = useAppStore((s) => s.isCreatingSession);
  const isLoading = useAppStore((s) => s.sessionStates.get(sessionId)?.isLoading ?? true);
  const currentProjectId = session.projectId;

  // Panel state — defaults to "files" so Panel always shows content
  const [panelTab, setPanelTab] = useState<PanelTab>("files");
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState<boolean>(false);

  useEffect(() => {
    if (!mainEl) {
      return;
    }
    const callback = () => setCompact(mainEl.offsetWidth < 1000);
    const observer = new ResizeObserver(callback);
    observer.observe(mainEl);
    callback();
    return () => observer.disconnect();
  }, [mainEl]);

  // Detail state
  const [detailType, setDetailType] = useState<DetailType | null>(null);
  const [detailFile, setDetailFile] = useState<string | null>(null);
  const [detailTerminalId, setDetailTerminalId] = useState<string | null>(null);

  const detailOpen = detailType !== null;

  // Handle preview file from file tree
  const handlePreviewFile = useCallback((file: string) => {
    setDetailType("file");
    setDetailFile(file);
    setDetailTerminalId(null);
  }, []);

  // Handle select terminal from terminal tab list
  const handleSelectTerminal = useCallback((terminalId: string) => {
    setDetailType("terminal");
    setDetailTerminalId(terminalId);
    setDetailFile(null);
  }, []);

  // Handle detail close
  const handleDetailClose = useCallback(() => {
    setDetailType(null);
    setDetailFile(null);
    setDetailTerminalId(null);
  }, []);

  // Clear detail on session change
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setDetailType(null);
    setDetailFile(null);
    setDetailTerminalId(null);
  }, [sessionId]);

  // Listen for fello-preview-file events (from tool-bubble, etc.)
  useEffect(() => {
    const handlePreviewFileEvent = (e: Event) => {
      const event = e as CustomEvent<{ projectId?: string | null; relativePath?: string | null }>;
      const relativePath = event.detail?.relativePath ?? null;
      const projectId = event.detail?.projectId ?? currentProjectId ?? null;
      if (!relativePath || !projectId) return;
      if (projectId !== currentProjectId) return;
      handlePreviewFile(relativePath);
    };
    document.addEventListener("fello-preview-file", handlePreviewFileEvent);
    return () => document.removeEventListener("fello-preview-file", handlePreviewFileEvent);
  }, [currentProjectId, handlePreviewFile]);

  // Listen for fello-open-token-usage events (from UsageButton)
  useEffect(() => {
    const handleOpenTokenUsage = () => {
      setDetailType("token-usage");
      setDetailFile(null);
      setDetailTerminalId(null);
    };
    document.addEventListener("fello-open-token-usage", handleOpenTokenUsage);
    return () => document.removeEventListener("fello-open-token-usage", handleOpenTokenUsage);
  }, []);

  // Coordinate initial loading and history hydration with restart/close/delete actions.
  const fetchingRef = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setConnectionError(false);

    const sessionState = useAppStore.getState().getSessionState(sessionId);
    const shouldLoadHistory =
      sessionState.messages.length === 0 && !isCreatingSession && sessionState.loadedAt === null;
    if (shouldLoadHistory && fetchingRef.current === sessionId) return;
    if (shouldLoadHistory) fetchingRef.current = sessionId;

    void loadSession(sessionId, { loadHistory: shouldLoadHistory })
      .catch((err) => {
        if (err instanceof SessionLifecycleBusyError) return;
        setConnectionError(true);
        toast.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (fetchingRef.current === sessionId) fetchingRef.current = null;
      });
  }, [sessionId, isCreatingSession, toast]);

  return (
    <main ref={setMainEl} className="flex min-w-0 flex-1 flex-col relative overflow-hidden">
      {isLoading || sessionConnected !== "connected" || isCreatingSession ? (
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="absolute left-0 top-0 right-0 h-12" style={{ WebkitAppRegion: "drag" }} />
          {connectionError && !isCreatingSession ? (
            <div className="flex w-full min-h-0 flex-1 overflow-y-auto">
              <SessionConnectionError key={sessionId} session={session} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-normal text-muted-foreground/60">
                {t("session.connecting")}
              </p>
            </div>
          )}
        </div>
      ) : sessionId ? (
        <div key={sessionId} className="relative flex h-full flex-col flex-1 min-h-0">
          {/* Outer: always 2 panels → Panel width stable */}
          <ResizablePanelGroup className="flex h-full min-h-0">
            {/* Left: chat + optional detail (inner resizable group) */}
            <ResizablePanel id="left" minSize={600}>
              <ResizablePanelGroup className="flex h-full min-h-0">
                {/* Chat — collapses when window too small with detail open */}
                <ResizablePanel
                  id="chat"
                  minSize={400}
                  disabled={compact && detailOpen}
                  collapsedSize={0}
                  maxSize={compact && detailOpen ? 0 : undefined}
                >
                  <Chat session={session} />
                </ResizablePanel>

                {/* Detail (conditional — only affects inner group) */}
                {detailOpen && (
                  <>
                    {!compact && <ResizableHandle className="bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250" />}
                    <ResizablePanel id="detail" defaultSize={400} minSize={300}>
                      <Detail
                        detailType={detailType}
                        projectId={currentProjectId}
                        file={detailFile}
                        terminalId={detailTerminalId}
                        session={session}
                        onClose={handleDetailClose}
                      />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle className="bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250" />

            {/* Right Panel — fixed pixel width, never recalculates */}
            <ResizablePanel
              id="panel"
              groupResizeBehavior="preserve-pixel-size"
              defaultSize={250}
              minSize={250}
              maxSize={400}
            >
              <Panel
                tab={panelTab}
                onTabChange={(tab) => setPanelTab(tab)}
                projectId={currentProjectId}
                previewFileId={detailType === "file" ? detailFile : null}
                activeTerminalId={detailType === "terminal" ? detailTerminalId : null}
                onPreviewFile={handlePreviewFile}
                onSelectTerminal={handleSelectTerminal}
              />
            </ResizablePanel>
          </ResizablePanelGroup>

          {(isLoading || isCreatingSession) && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-normal text-foreground/50">{t("session.connecting")}</p>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

/**
 * 会话加载失败态。
 *
 * 直接暴露会话级配置（权限 / features / MCP servers）：加载失败往往是某个 MCP server
 * 起不来、或 feature 之间互斥导致的，只留一个「重试」会让用户无路可走。这里让用户就地
 * 修正配置，再用修正后的配置重新加载——`restartSession` 会先写入配置、再强制重启 bridge，
 * 与 iLink 的 `!f` / `!c` 走同一条链路。
 *
 * 由父级以 `key={sessionId}` 挂载，因此切换会话时本地配置会重置为新会话的配置。
 */
function SessionConnectionError({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const { toast } = useMessage();
  const [mcpServers, setMcpServers] = useState(session.mcpServers);
  const [features, setFeatures] = useState(session.features);
  const [permissionMode, setPermissionMode] = useState(session.permissionMode);
  const [isReloading, setIsReloading] = useState(false);

  const handleReload = async () => {
    if (isReloading) return;
    setIsReloading(true);
    try {
      await restartSession({ session, mcpServers, features, permissionMode });
    } catch (err) {
      console.error("Failed to reload session:", err);
      if (err instanceof SessionLifecycleBusyError) {
        toast.error(
          t("session.operationInProgress", "Another session operation is already in progress."),
        );
        return;
      }
      const cause = err instanceof RestartSessionError ? err.cause : err;
      const fallback =
        err instanceof RestartSessionError && err.stage === "update"
          ? t("session.failedToUpdateMcpServers", "Failed to update MCP servers")
          : t("session.failedToLoadSession", "Failed to load session.");
      toast.error(extractErrorMessage(cause) || fallback);
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <div className="m-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-8">
      <div className="flex flex-col items-center gap-1.5">
        <TriangleAlert className="size-6 text-amber-500" />
        <p className="text-sm font-normal text-muted-foreground">{t("session.connectionFailed")}</p>
        <p className="text-center text-xs text-muted-foreground/60">
          {t(
            "session.connectionFailedHint",
            "If a session setting (such as MCP or features) is causing this, adjust it below and reload.",
          )}
        </p>
      </div>

      <div className="w-full rounded-lg border border-border bg-card/50 p-3">
        <SessionConfigFields
          variant="card"
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          features={features}
          onFeaturesChange={setFeatures}
          mcpServers={mcpServers}
          onMcpServersChange={setMcpServers}
        />
      </div>

      <Button size="sm" onClick={() => void handleReload()} disabled={isReloading}>
        {isReloading ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <RotateCw className="mr-1.5 size-3.5" />
        )}
        {t("session.reload", "Reload")}
      </Button>
    </div>
  );
}
