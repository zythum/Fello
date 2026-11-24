import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type {
  AssistantDiary,
  AssistantStatus,
  AssistantWorkerInfo,
  SessionNotificationFelloExt,
} from "../../../shared/schema";
import { assistantProjectId } from "../../../shared/assistant";
import { request, subscribe } from "../../backend";
import { useAppStore } from "../../store";
import { loadAssistantHistory, queueAssistantNotification } from "../../lib/assistant-lifecycle";
import { FileDetail } from "../files/detail/file-detail";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useTtsAutoRead } from "../../lib/tts/use-tts-auto-read";
import { AssistantChat } from "./chat/chat";
import { DiaryDetail } from "./detail/diary-detail";
import { MemoryDetail } from "./detail/memory-detail";
import { WorkerDetail } from "./detail/worker-detail";
import { Panel, type PanelTab } from "./panel/panel";

/**
 * 个人助理页面：负责状态订阅、详情 / 面板布局与初始化遮罩。
 * 聊天列（header / 消息流 / 输入区 / Ask User）在 `./chat/`，与 session 的 `session/chat/` 对应。
 */
export function Assistant({ assistantId }: { assistantId: string }) {
  const { t } = useTranslation();
  const resetSessionState = useAppStore((state) => state.resetSessionState);
  const assistantConfig = useAppStore((state) =>
    state.assistants.find((item) => item.id === assistantId),
  );
  const assistantName =
    assistantConfig?.name?.trim() || t("assistant.title", "Personal Assistant");
  const projectId = assistantProjectId(assistantId);

  const [panelTab, setPanelTab] = useState<PanelTab>("calendar");
  const [detailFile, setDetailFile] = useState<string | null>(null);
  const [detailDiary, setDetailDiary] = useState<{
    diary: AssistantDiary;
    timeZone: string;
  } | null>(null);
  const [detailMemory, setDetailMemory] = useState(false);
  const [detailWorker, setDetailWorker] = useState<AssistantWorkerInfo | null>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const isHistoryLoading = useAppStore(
    (state) => state.sessionStates.get(assistantId)?.isLoading ?? true,
  );
  const panelOpen = useAppStore((state) => state.panelOpen);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  useTtsAutoRead(assistantId);

  useEffect(() => {
    let active = true;
    resetSessionState(assistantId);
    // reset 会清空 askUser 队列：把后端仍然挂着的请求补回来（离开页面期间可能产生）。
    void request
      .getPendingAskUserRequests({ sessionId: assistantId })
      .then((pending) => {
        for (const req of pending) {
          useAppStore.getState().addAskUserRequest(assistantId, req);
        }
      })
      .catch(() => {});

    const onStatus = (detail: { assistantId: string; status: AssistantStatus }) => {
      if (active && detail.assistantId === assistantId) setStatus(detail.status);
    };
    const onUpdate = (detail: {
      assistantId: string;
      notification: SessionNotificationFelloExt;
    }) => {
      if (active && detail.assistantId === assistantId) {
        queueAssistantNotification(assistantId, detail.notification);
      }
    };

    subscribe.on("assistant-status-changed", onStatus);
    subscribe.on("assistant-update", onUpdate);
    void Promise.all([
      request.getAssistantStatus({ assistantId }),
      loadAssistantHistory(assistantId),
    ])
      .then(([nextStatus]) => {
        if (active) setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus({
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
          sourceAgentId: null,
          enabled: true,
          workspace: "",
          isStreaming: false,
          dreaming: false,
          models: null,
          thoughtLevels: null,
        });
      });

    return () => {
      active = false;
      subscribe.off("assistant-status-changed", onStatus);
      subscribe.off("assistant-update", onUpdate);
    };
  }, [assistantId, resetSessionState]);

  // Tool/share bubbles dispatch this when their preview button is clicked.
  useEffect(() => {
    const handlePreviewFile = (event: Event) => {
      const detail = (
        event as CustomEvent<{ projectId?: string | null; relativePath?: string | null }>
      ).detail;
      const relativePath = detail?.relativePath ?? null;
      if (!relativePath) return;
      if (detail?.projectId && detail.projectId !== projectId) return;
      setDetailMemory(false);
      setDetailDiary(null);
      setDetailWorker(null);
      setDetailFile(relativePath);
    };
    document.addEventListener("fello-preview-file", handlePreviewFile);
    return () => document.removeEventListener("fello-preview-file", handlePreviewFile);
  }, [projectId]);

  useEffect(() => {
    if (!mainEl) return;
    const callback = () => setCompact(mainEl.offsetWidth < 1000);
    const observer = new ResizeObserver(callback);
    observer.observe(mainEl);
    callback();
    return () => observer.disconnect();
  }, [mainEl]);

  const isInitializing =
    status === null || status.connectionStatus === "connecting" || isHistoryLoading;

  const hasDetail =
    detailFile !== null || detailDiary !== null || detailMemory || detailWorker !== null;

  const openFile = useCallback((file: string) => {
    setDetailMemory(false);
    setDetailDiary(null);
    setDetailWorker(null);
    setDetailFile(file);
  }, []);

  const openDiary = useCallback((diary: AssistantDiary, timeZone: string) => {
    setDetailMemory(false);
    setDetailFile(null);
    setDetailWorker(null);
    setDetailDiary({ diary, timeZone });
  }, []);

  const openMemory = useCallback(() => {
    setDetailFile(null);
    setDetailDiary(null);
    setDetailWorker(null);
    setDetailMemory(true);
  }, []);

  const openWorker = useCallback((worker: AssistantWorkerInfo) => {
    setDetailFile(null);
    setDetailDiary(null);
    setDetailMemory(false);
    setDetailWorker(worker);
  }, []);

  return (
    <main
      ref={setMainEl}
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* Content stays mounted and fades in once initialization finishes, like Session's chat area. */}
      <ResizablePanelGroup
        className={cn(
          "flex h-full min-h-0 flex-1 transition-opacity duration-500",
          isInitializing && "pointer-events-none opacity-0",
        )}
      >
        {/* 与 Session 一致：外层永远两个 panel，detail 只影响左侧内层 group，右侧 panel 宽度稳定。 */}
        <ResizablePanel id="left" defaultSize={600} minSize={600}>
          <ResizablePanelGroup className="flex h-full min-h-0">
            <ResizablePanel
              id="chat"
              minSize={400}
              disabled={compact && hasDetail}
              collapsedSize={0}
              maxSize={compact && hasDetail ? 0 : undefined}
            >
              <AssistantChat
                assistantId={assistantId}
                assistantName={assistantName}
                status={status}
                onStatusChange={setStatus}
                onOpenMemory={openMemory}
                panelOpen={panelOpen}
                onOpenPanel={() => setPanelOpen(true)}
              />
            </ResizablePanel>

            {hasDetail && (
              <>
                {!compact && (
                  <ResizableHandle className="bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250" />
                )}
                <ResizablePanel id="detail" defaultSize={500} minSize={300}>
                  {detailFile ? (
                    <FileDetail
                      compact={compact}
                      projectId={projectId}
                      file={detailFile}
                      onClose={() => setDetailFile(null)}
                    />
                  ) : detailDiary ? (
                    <DiaryDetail
                      key={detailDiary.diary.file}
                      assistantId={assistantId}
                      diary={detailDiary.diary}
                      timeZone={detailDiary.timeZone}
                      compact={compact}
                      onClose={() => setDetailDiary(null)}
                    />
                  ) : detailMemory ? (
                    <MemoryDetail
                      assistantId={assistantId}
                      compact={compact}
                      onClose={() => setDetailMemory(false)}
                    />
                  ) : detailWorker ? (
                    <WorkerDetail
                      key={detailWorker.id}
                      assistantId={assistantId}
                      worker={detailWorker}
                      compact={compact}
                      onClose={() => setDetailWorker(null)}
                    />
                  ) : null}
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>

        {/* Collapsed: no handle, and the panel cannot be dragged open. Same pattern as Session. */}
        <ResizableHandle
          disabled={!panelOpen}
          className={cn(
            "bg-border/70 data-[separator=hover]:bg-ring/50 data-[separator=focus]:bg-ring/50 data-[separator=active]:bg-ring/80 duration-250",
            !panelOpen && "opacity-0",
          )}
        />

        <ResizablePanel
          id="panel"
          groupResizeBehavior="preserve-pixel-size"
          defaultSize={280}
          minSize={250}
          maxSize={panelOpen ? 400 : 0}
          inert={!panelOpen}
        >
          <Panel
            tab={panelTab}
            onTabChange={setPanelTab}
            onOpenChange={setPanelOpen}
            assistantId={assistantId}
            projectId={projectId}
            workspace={status?.workspace ?? ""}
            previewFileId={detailFile}
            onPreviewFile={openFile}
            onOpenDiary={openDiary}
            onOpenWorker={openWorker}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {isInitializing && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background animate-in fade-in"
          style={{ WebkitAppRegion: "drag" }}
        >
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-normal text-muted-foreground/60">
            {t("assistant.connecting", "Connecting…")}
          </p>
        </div>
      )}
    </main>
  );
}
