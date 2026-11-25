import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, CpuAi, FolderOpen, SquareChevronRight, X } from "lucide-react";
import type {
  AssistantWorkerInfo,
  SessionInfo,
  SessionNotificationFelloExt,
} from "../../../../shared/schema";
import { request, subscribe } from "../../../backend";
import { electron } from "../../../electron";
import { useAppStore, type SessionState } from "../../../store";
import { reduceNotifications } from "../../../lib/notification-history";
import { ChatAreaView } from "../../chat/chat-area";
import { ErrorState } from "../../common/loading-state";
import {
  WORKER_CONNECTION_DOT,
  WORKER_CONNECTION_FALLBACKS,
  WORKER_CONNECTION_TEXT,
  WORKER_STATUS_DOT,
  WORKER_STATUS_FALLBACKS,
  WORKER_STATUS_TEXT,
} from "../worker-status";
import { cn } from "@/lib/utils";

/** A fresh local reducer state; worker detail never touches the global session store. */
function emptyWorkerSessionState(): SessionState {
  return {
    messages: [],
    isLoading: false,
    terminalLogs: {},
    askUserRequests: [],
    activeToolCalls: new Map(),
    activeSubagents: new Map(),
    activeCompactions: new Map(),
    pendingNotifications: [],
    historySegments: [],
    liveHistoryNotifications: [],
    previousHistorySegmentId: undefined,
    draftInput: "",
    draftAttachments: [],
    completedAt: null,
    completedStatus: null,
    loadedAt: null,
  };
}

/**
 * Replays raw worker notifications into ChatMessage[] using the same reducer as
 * a normal chat, so the detail view gets identical bubbles without a session.
 */
function replayWorkerNotifications(
  sessionId: string,
  history: SessionNotificationFelloExt[],
  live: SessionNotificationFelloExt[],
): { state: SessionState; known: Set<string> } {
  const known = new Set<string>();
  const historyResult = reduceNotifications(sessionId, emptyWorkerSessionState(), history, known);
  const liveResult = reduceNotifications(sessionId, historyResult.state, live, known);
  return { state: liveResult.state, known };
}

/** Read-only view of one worker's persisted ACP transcript. */
export function WorkerDetail({
  assistantId,
  worker,
  compact,
  onClose,
}: {
  assistantId: string;
  worker: AssistantWorkerInfo;
  compact: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMacApp = useAppStore((s) => s.isMacApp);
  const isFullScreen = useAppStore((s) => s.isFullScreen);
  const showMacTrafficLightSpace = compact && isMacApp && !isFullScreen;

  const [info, setInfo] = useState(worker);
  const [missing, setMissing] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>(emptyWorkerSessionState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousSegmentId, setPreviousSegmentId] = useState<number | undefined>(undefined);

  const stateRef = useRef<SessionState>(emptyWorkerSessionState());
  const knownRef = useRef<Set<string>>(new Set());
  const mainSessionRef = useRef<string | null>(null);
  const historyRef = useRef<SessionNotificationFelloExt[]>([]);
  const liveRef = useRef<SessionNotificationFelloExt[]>([]);
  const liveQueueRef = useRef<SessionNotificationFelloExt[]>([]);
  const flushFrameRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadedRef.current = false;
    stateRef.current = emptyWorkerSessionState();
    knownRef.current = new Set();
    mainSessionRef.current = null;
    historyRef.current = [];
    liveRef.current = [];
    liveQueueRef.current = [];

    void request
      .getAssistantWorkerHistorySegment({ assistantId, workerId: worker.id })
      .then((segment) => {
        if (!active) return;
        const sessionId = `worker:${segment.sessionId}`;
        mainSessionRef.current = sessionId;
        historyRef.current = segment.messages;
        const replayed = replayWorkerNotifications(sessionId, historyRef.current, liveRef.current);
        stateRef.current = replayed.state;
        knownRef.current = replayed.known;
        loadedRef.current = true;
        liveQueueRef.current = [];
        setSessionState(replayed.state);
        setPreviousSegmentId(segment.previousSegmentId);
        setIsLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setIsLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      active = false;
    };
  }, [assistantId, worker.id]);

  const flushLive = useCallback(() => {
    if (flushFrameRef.current != null) return;
    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      const sessionId = mainSessionRef.current;
      const batch = liveQueueRef.current;
      liveQueueRef.current = [];
      if (!loadedRef.current || !sessionId || batch.length === 0) return;
      const result = reduceNotifications(sessionId, stateRef.current, batch, knownRef.current);
      if (result.applied.length === 0) return;
      stateRef.current = result.state;
      setSessionState(result.state);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (flushFrameRef.current != null) cancelAnimationFrame(flushFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const onChanged = (payload: { assistantId: string; workers: AssistantWorkerInfo[] }) => {
      if (payload.assistantId !== assistantId) return;
      const next = payload.workers.find((candidate) => candidate.id === worker.id);
      if (next) {
        setInfo(next);
        setMissing(false);
      } else {
        setMissing(true);
      }
    };
    subscribe.on("assistant-workers-changed", onChanged);
    return () => subscribe.off("assistant-workers-changed", onChanged);
  }, [assistantId, worker.id]);

  useEffect(() => {
    const onUpdate = (payload: {
      assistantId: string;
      workerId: string;
      notification: SessionNotificationFelloExt;
    }) => {
      if (payload.assistantId !== assistantId || payload.workerId !== worker.id) return;
      liveRef.current.push(payload.notification);
      liveQueueRef.current.push(payload.notification);
      if (!loadedRef.current) return;
      flushLive();
    };
    subscribe.on("assistant-worker-update", onUpdate);
    return () => subscribe.off("assistant-worker-update", onUpdate);
  }, [assistantId, worker.id, flushLive]);

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    const sessionId = mainSessionRef.current;
    if (previousSegmentId === undefined || !sessionId) return false;
    try {
      const segment = await request.getAssistantWorkerHistorySegment({
        assistantId,
        workerId: worker.id,
        segmentId: previousSegmentId,
      });
      historyRef.current = [...segment.messages, ...historyRef.current];
      const replayed = replayWorkerNotifications(sessionId, historyRef.current, liveRef.current);
      stateRef.current = replayed.state;
      knownRef.current = replayed.known;
      setSessionState(replayed.state);
      setPreviousSegmentId(segment.previousSegmentId);
      return true;
    } catch (reason) {
      console.error("Failed to load earlier worker history", reason);
      return false;
    }
  }, [assistantId, previousSegmentId, worker.id]);

  const session = useMemo<SessionInfo>(
    () => ({
      id: `worker:${info.id}`,
      title: info.name || info.id,
      cwd: info.cwd,
      projectId: "",
      projectTitle: "",
      agentId: info.agentId,
      resumeId: info.id,
      createdAt: info.createdAt,
      updatedAt: info.lastActiveAt,
      mcpServers: [],
      features: [],
      permissionMode: "ask",
      models: null,
      modes: null,
      thoughtLevels: null,
      initializeInfo: null,
      availableCommands: [],
      usage: null,
      lastTurnUsage: null,
      isStreaming: info.status === "running" || info.status === "awaiting_permission",
      connectionStatus: info.connectionStatus,
    }),
    [info],
  );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2 transition-[padding]",
          !compact ? "" : sidebarOpen ? "pl-2.5" : showMacTrafficLightSpace ? "pl-27" : "pl-10",
        )}
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <SquareChevronRight className="size-4 shrink-0 text-sky-500 dark:text-sky-400" />
          <span
            className="min-w-0 truncate text-xs text-foreground/80"
            title={info.name || info.id}
          >
            {info.name || info.id}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <ErrorState message={error} />
        ) : isLoading ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {t("assistant.workers.detail.loading", "Loading transcript…")}
          </p>
        ) : missing ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {t("assistant.workers.detail.missing", "This worker no longer exists")}
          </p>
        ) : sessionState.messages.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {t("assistant.workers.detail.empty", "No transcript yet")}
          </p>
        ) : (
          <ChatAreaView
            session={session}
            messages={sessionState.messages}
            activeSubagents={sessionState.activeSubagents}
            previousSegmentId={previousSegmentId}
            loadPreviousHistory={loadEarlier}
            showTimeline={false}
            name={info.typeName ?? undefined}
            readOnly
            focusTargetId="worker-chat-area"
            handleScrollToBottomEvents={false}
            handleScrollToMessageEvents
          />
        )}
      </div>

      <WorkerParamsDock worker={info} />
    </div>
  );
}

/** Read-only worker parameters, docked where a chat input would normally sit. */
function WorkerParamsDock({ worker }: { worker: AssistantWorkerInfo }) {
  const { t } = useTranslation();
  const turnId = worker.currentTurnId ?? worker.lastTurnId;
  const typeLabel = worker.typeName ?? worker.typeId ?? "—";
  const modelLabel = worker.modelId ?? t("assistant.workers.agentDefault", "Agent default");
  const connectionLabel = t(
    `assistant.workers.connection.${worker.connectionStatus}`,
    WORKER_CONNECTION_FALLBACKS[worker.connectionStatus],
  );
  const statusLabel = t(
    `assistant.workers.status.${worker.status}`,
    WORKER_STATUS_FALLBACKS[worker.status],
  );

  return (
    <div className="relative -mt-6 shrink-0 p-6">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-input bg-card shadow-[0_0_20px] shadow-primary/10 dark:shadow-primary/20">
        <div className="flex min-w-0 items-center gap-3 border-b border-border/60 p-2">
          <span
            className="min-w-0 truncate text-xs font-medium text-foreground/85"
            title={worker.name || worker.id}
          >
            {worker.name || worker.id}
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center rounded-sm font-mono text-[10px] whitespace-nowrap text-muted-foreground/70 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
            title={`${t("assistant.workers.openDataDir", "Open worker folder")}: ${worker.dataDir}`}
            onClick={() => void electron.revealInFinder(worker.dataDir).catch(() => {})}
          >
            {worker.id}
          </button>
          <span
            className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70"
            title={turnId ?? undefined}
          >
            {t("assistant.workers.detail.turnSummary", "Turn {{count}}", {
              count: worker.turnCount ?? 0,
            })}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(38.2%,auto)] divide-x divide-border/60">
          <div className="flex min-w-0 flex-col justify-center gap-2 p-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Award className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span
                className="min-w-0 truncate text-xs font-medium text-foreground/85"
                title={typeLabel}
              >
                {typeLabel}
              </span>
            </div>
            <div
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/70"
              title={`${worker.agentId} · ${modelLabel}`}
            >
              <CpuAi className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="flex min-w-0 items-center gap-0.5">
                <span className="min-w-0 truncate font-mono">{worker.agentId}</span>
                <span className="shrink-0 text-[11px] leading-none text-muted-foreground/40">
                  ·
                </span>
                <span className="min-w-0 truncate font-mono">{modelLabel}</span>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-2 p-2 text-[11px]">
            <span
              className={cn(
                "flex min-w-0 items-center gap-1",
                WORKER_CONNECTION_TEXT[worker.connectionStatus],
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  WORKER_CONNECTION_DOT[worker.connectionStatus],
                )}
              />
              <span className="truncate">{connectionLabel}</span>
            </span>

            <span
              className={cn("flex min-w-0 items-center gap-1", WORKER_STATUS_TEXT[worker.status])}
            >
              <span
                className={cn("size-1.5 shrink-0 rounded-full", WORKER_STATUS_DOT[worker.status])}
              />
              <span className="truncate">{statusLabel}</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-1 border-t border-border/60 p-2 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
          title={`${t("assistant.workers.revealWorkspace", "Reveal in Finder")}: ${worker.cwd}`}
          onClick={() => void electron.revealInFinder(worker.cwd).catch(() => {})}
        >
          <FolderOpen className="size-3 shrink-0 text-muted-foreground/50" />
          <span className="min-w-0 truncate">{worker.cwd}</span>
        </button>

        {worker.lastError && (
          <div
            className="border-t border-border/60 p-2 text-[10px] text-destructive/80 line-clamp-2 whitespace-pre-wrap wrap-break-word"
            title={worker.lastError}
          >
            {worker.lastError}
          </div>
        )}
      </div>
    </div>
  );
}
