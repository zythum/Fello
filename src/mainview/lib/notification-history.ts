import type { SessionNotificationFelloExt } from "../../shared/schema";
import { useAppStore, type SessionState } from "../store";
import { reduceFlushStreaming, reduceSessionNotification } from "./session-state-reducer";

export interface NotificationHistorySegmentResponse {
  segmentId: number;
  previousSegmentId?: number;
  messages: SessionNotificationFelloExt[];
}

export interface NotificationHistoryControllerOptions {
  sessionId: string;
  loadSegment: (
    segmentId?: number,
  ) => Promise<NotificationHistorySegmentResponse | null | undefined>;
  initialLoadError: () => Error;
  previousLoadError: () => Error;
}

function notificationDisplayId(notification: SessionNotificationFelloExt): string | undefined {
  return notification.update._meta?.fello?.displayId;
}

export function reduceNotifications(
  sessionId: string,
  state: SessionState,
  notifications: SessionNotificationFelloExt[],
  knownDisplayIds = new Set<string>(),
): { state: SessionState; applied: SessionNotificationFelloExt[] } {
  let nextState = state;
  const applied: SessionNotificationFelloExt[] = [];

  for (const notification of notifications) {
    const displayId = notificationDisplayId(notification);
    if (displayId && knownDisplayIds.has(displayId)) continue;
    if (displayId) knownDisplayIds.add(displayId);
    if (!notification.update) continue;
    nextState = reduceSessionNotification(sessionId, nextState, notification);
    applied.push(notification);
  }

  return { state: nextState, applied };
}

function replayLoadedHistory(
  sessionId: string,
  currentState: SessionState,
  historySegments: SessionState["historySegments"],
  liveNotifications: SessionNotificationFelloExt[],
): { state: SessionState; knownDisplayIds: Set<string> } {
  const initialState: SessionState = {
    ...currentState,
    messages: [],
    activeToolCalls: new Map(),
    activeSubagents: new Map(),
    activeCompactions: new Map(),
  };
  const knownDisplayIds = new Set<string>();
  const historyNotifications = historySegments
    .slice()
    .sort((a, b) => a.segmentId - b.segmentId)
    .flatMap((segment) => segment.messages);
  const history = reduceNotifications(
    sessionId,
    initialState,
    historyNotifications,
    knownDisplayIds,
  );
  const live = reduceNotifications(sessionId, history.state, liveNotifications, knownDisplayIds);
  return { state: live.state, knownDisplayIds };
}

export function createNotificationHistoryController({
  sessionId,
  loadSegment,
  initialLoadError,
  previousLoadError,
}: NotificationHistoryControllerOptions) {
  let previousLoad: Promise<boolean> | undefined;

  function finishLoading(): void {
    useAppStore.getState().updateSessionState(sessionId, (currentState) => {
      const { state, applied } = reduceNotifications(
        sessionId,
        currentState,
        currentState.pendingNotifications,
      );
      return {
        ...reduceFlushStreaming(state),
        liveHistoryNotifications: [...currentState.liveHistoryNotifications, ...applied],
        pendingNotifications: [],
        isLoading: false,
      };
    });
  }

  function queueNotification(notification: SessionNotificationFelloExt): void {
    queueNotifications([notification]);
  }

  /** Applies a batch in one store write, so the history replay runs once per batch. */
  function queueNotifications(notifications: SessionNotificationFelloExt[]): void {
    if (notifications.length === 0) return;
    useAppStore.getState().updateSessionState(sessionId, (currentState) => {
      if (currentState.isLoading) {
        return { pendingNotifications: [...currentState.pendingNotifications, ...notifications] };
      }
      const knownDisplayIds = new Set<string>();
      replayLoadedHistory(
        sessionId,
        currentState,
        currentState.historySegments,
        currentState.liveHistoryNotifications,
      ).knownDisplayIds.forEach((displayId) => knownDisplayIds.add(displayId));
      const { state, applied } = reduceNotifications(
        sessionId,
        currentState,
        notifications,
        knownDisplayIds,
      );
      return applied.length === 0
        ? {}
        : {
            ...state,
            liveHistoryNotifications: [...currentState.liveHistoryNotifications, ...applied],
          };
    });
  }

  async function loadInitial({ keepLoading = false }: { keepLoading?: boolean } = {}): Promise<
    Set<string>
  > {
    try {
      const result = await loadSegment();
      if (!result) throw initialLoadError();

      const historyDisplayIds = new Set<string>();
      useAppStore.getState().updateSessionState(sessionId, (currentState) => {
        const historySegments = [{ segmentId: result.segmentId, messages: result.messages }];
        const replayed = replayLoadedHistory(sessionId, currentState, historySegments, []);
        for (const displayId of replayed.knownDisplayIds) historyDisplayIds.add(displayId);
        const pending = reduceNotifications(
          sessionId,
          replayed.state,
          currentState.pendingNotifications,
          historyDisplayIds,
        );
        return {
          ...reduceFlushStreaming(pending.state),
          historySegments,
          liveHistoryNotifications: pending.applied,
          previousHistorySegmentId: result.previousSegmentId,
          isLoading: keepLoading,
          pendingNotifications: [],
        };
      });
      return historyDisplayIds;
    } catch (error) {
      finishLoading();
      throw error;
    }
  }

  function loadPrevious(): Promise<boolean> {
    if (previousLoad) return previousLoad;
    previousLoad = (async () => {
      const previousSegmentId = useAppStore
        .getState()
        .getSessionState(sessionId).previousHistorySegmentId;
      if (previousSegmentId === undefined) return false;

      const result = await loadSegment(previousSegmentId);
      if (!result) throw previousLoadError();
      useAppStore.getState().updateSessionState(sessionId, (currentState) => {
        const historySegments = [
          { segmentId: result.segmentId, messages: result.messages },
          ...currentState.historySegments.filter(
            (segment) => segment.segmentId !== result.segmentId,
          ),
        ];
        const replayed = replayLoadedHistory(
          sessionId,
          currentState,
          historySegments,
          currentState.liveHistoryNotifications,
        );
        const pending = reduceNotifications(
          sessionId,
          replayed.state,
          currentState.pendingNotifications,
          replayed.knownDisplayIds,
        );
        return {
          ...reduceFlushStreaming(pending.state),
          historySegments,
          liveHistoryNotifications: [...currentState.liveHistoryNotifications, ...pending.applied],
          previousHistorySegmentId: result.previousSegmentId,
          pendingNotifications: [],
        };
      });
      return true;
    })();
    return previousLoad.finally(() => {
      previousLoad = undefined;
    });
  }

  return { finishLoading, loadInitial, loadPrevious, queueNotification, queueNotifications };
}
