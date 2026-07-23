import { useEffect, useMemo } from "react";
import { useTaskFile } from "../common/use-task-file";
import { LoadingState } from "../common/loading-state";
import { MessageBubble } from "../../../../chat-bubbles/message-bubble";
import { isValidMessageToDisplay } from "../../../../../lib/chat-message";
import {
  reduceSessionNotification,
  reduceFlushStreaming,
} from "../../../../../lib/session-state-reducer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "../../../../../store";
import { Bot, Clock, MessageSquareText } from "lucide-react";
import type { SessionNotificationFelloExt, SessionInfo } from "../../../../../../shared/schema";
import type { SessionState } from "../../../../../store";

interface ConversationDetailProps {
  scheduleId: string;
  taskId: string;
  fileName: string;
}

/** Meta information about the automation run */
interface ConversationMeta {
  name?: string;
  agentId?: string;
  modelId?: string | null;
  prompt?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Conversation data format stored in .fello-conversation.json */
interface ConversationData {
  meta: ConversationMeta | null;
  notifications: SessionNotificationFelloExt[];
  terminalLogs: Record<string, string>;
}

/**
 * Parse .fello-conversation.json content.
 * Supports both formats:
 * - New format: { __type: "fello-conversation", meta: {...}, notifications: [...], terminalLogs: {...} }
 * - Legacy format: [...] (array of notifications directly)
 */
function parseConversationData(content: string): ConversationData | null {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      // Legacy format: plain array of notifications
      return { meta: null, notifications: parsed, terminalLogs: {} };
    }
    if (parsed && Array.isArray(parsed.notifications)) {
      return {
        meta: parsed.meta ?? null,
        notifications: parsed.notifications,
        terminalLogs: parsed.terminalLogs ?? {},
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Replay notifications through the session state reducer to produce ChatMessage[] */
function replayNotifications(notifications: SessionNotificationFelloExt[]) {
  const initial: SessionState = {
    messages: [],
    usage: null,
    lastTurnUsage: null,
    isLoading: false,
    terminalLogs: {},
    askUserRequests: [],
    activeToolCalls: new Map(),
    activeSubagents: new Map(),
    pendingNotifications: [],
    availableCommands: [],
    draftInput: "",
    draftAttachments: [],
    completedAt: null,
    completedStatus: null,
    loadedAt: null,
  };

  // Extract the real session ID from the first notification to match the reducer's logic.
  // The reducer uses `sessionId.slice(sessionId.indexOf(":") + 1)` as resumeId,
  // and compares it against `notification.sessionId` to distinguish main vs sub-agent messages.
  const realSessionId = notifications.find((n) => n.sessionId)?.sessionId ?? "automation";
  const fakeSessionId = `agent:${realSessionId}`;

  let state = initial;
  for (const notification of notifications) {
    if (!notification?.update) continue;
    state = reduceSessionNotification(fakeSessionId, state, notification);
  }
  // Flush any in-progress tool calls to "completed" since automation is finished
  state = reduceFlushStreaming(state);
  return state.messages;
}

/** Generate a unique automation session ID scoped to this task */
function getAutomationSessionId(scheduleId: string, taskId: string) {
  return `automation:${scheduleId}:${taskId}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  return remaining > 0 ? `${m}m ${remaining}s` : `${m}m`;
}

function MetaHeader({ meta }: { meta: ConversationMeta }) {
  const duration = meta.startedAt && meta.completedAt ? meta.completedAt - meta.startedAt : null;

  return (
    <div className="border-b border-border/50 pb-4 mb-4 space-y-2">
      {meta.name && <h2 className="text-sm font-medium text-foreground">{meta.name}</h2>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {meta.agentId && (
          <span className="flex items-center gap-1">
            <Bot className="size-3" />
            {meta.agentId}
            {meta.modelId && <span className="text-muted-foreground/60">· {meta.modelId}</span>}
          </span>
        )}
        {meta.startedAt && (
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {new Date(meta.startedAt).toLocaleString()}
            {duration != null && (
              <span className="text-muted-foreground/60">· {formatDuration(duration)}</span>
            )}
          </span>
        )}
      </div>
      {meta.prompt && (
        <div className="flex items-start gap-1 text-xs text-muted-foreground/80 mt-1">
          <MessageSquareText className="size-3 mt-0.5 shrink-0" />
          <span className="line-clamp-2">{meta.prompt}</span>
        </div>
      )}
    </div>
  );
}

export function ConversationDetail({ scheduleId, taskId, fileName }: ConversationDetailProps) {
  const { content, loading, errorMsg } = useTaskFile(scheduleId, taskId, fileName);

  const automationSessionId = useMemo(
    () => getAutomationSessionId(scheduleId, taskId),
    [scheduleId, taskId],
  );

  /** Stub session using the automation-scoped ID so AgentTerminalOutput can find logs */
  const stubSession: SessionInfo = useMemo(
    () => ({
      id: automationSessionId,
      title: "Automation",
      cwd: "",
      projectId: "",
      projectTitle: "",
      agentId: "",
      resumeId: "automation",
      createdAt: 0,
      updatedAt: 0,
      mcpServers: [],
      features: [],
      permissionMode: "allow-all",
      models: null,
      modes: null,
      thoughtLevels: null,
      initializeInfo: null,
      isStreaming: false,
      connectionStatus: "connected",
    }),
    [automationSessionId],
  );

  const data = useMemo(() => {
    if (!content) return null;
    return parseConversationData(content);
  }, [content]);

  const messages = useMemo(() => {
    if (!data) return [];
    return replayNotifications(data.notifications);
  }, [data]);

  // Inject terminal logs into the global store so AgentTerminalOutput can read them
  useEffect(() => {
    if (!data?.terminalLogs) return;
    const terminalLogs = data.terminalLogs;
    if (Object.keys(terminalLogs).length === 0) return;

    // Directly inject into sessionStates to bypass the sessions-list guard in updateSessionState
    useAppStore.setState((state) => {
      const map = new Map(state.sessionStates);
      const current = map.get(automationSessionId);
      const base: SessionState = current ?? {
        messages: [],
        usage: null,
        lastTurnUsage: null,
        isLoading: false,
        terminalLogs: {},
        askUserRequests: [],
        activeToolCalls: new Map(),
        activeSubagents: new Map(),
        pendingNotifications: [],
        availableCommands: [],
        draftInput: "",
        draftAttachments: [],
        completedAt: null,
        completedStatus: null,
        loadedAt: null,
      };
      map.set(automationSessionId, {
        ...base,
        terminalLogs: { ...base.terminalLogs, ...terminalLogs },
      });
      return { sessionStates: map };
    });

    // Cleanup: remove the injected session state on unmount
    return () => {
      useAppStore.setState((state) => {
        const map = new Map(state.sessionStates);
        map.delete(automationSessionId);
        return { sessionStates: map };
      });
    };
  }, [data, automationSessionId]);

  if (loading) return <LoadingState />;
  if (errorMsg) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {errorMsg}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No conversation data
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto p-4">
        {data?.meta && <MetaHeader meta={data.meta} />}
        <div className="space-y-1">
          {messages.filter(isValidMessageToDisplay).map((msg, i) => (
            <MessageBubble key={msg.displayId ?? i} session={stubSession} message={msg} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
