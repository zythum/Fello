import type { AgentInfo, Feature, SessionInfo } from "../../shared/schema";
import { request } from "../backend";
import { useAppStore } from "../store";
import { createNotificationHistoryController, reduceNotifications } from "./notification-history";
import { reduceFlushStreaming } from "./session-state-reducer";

export type RestartSessionErrorStage = "update" | "load";

export class RestartSessionError extends Error {
  constructor(
    public readonly stage: RestartSessionErrorStage,
    public readonly cause: unknown,
  ) {
    super(stage === "update" ? "Failed to update session." : "Failed to load session.");
    this.name = "RestartSessionError";
  }
}

export function isSessionLifecycleBusy(sessionId: string): boolean {
  return activeLifecycleOperations.has(sessionId);
}

export type SessionLifecycleOperation =
  | "load"
  | "history"
  | "restart"
  | "close"
  | "delete"
  | "reset";

export class SessionLifecycleBusyError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly operation: SessionLifecycleOperation,
  ) {
    const operationLabel =
      operation === "restart"
        ? "restarting"
        : operation === "close"
          ? "closing"
          : operation === "delete"
            ? "being deleted"
            : operation === "reset"
              ? "being reset"
              : operation === "history"
                ? "loading history"
                : "loading";
    super(`Session is already ${operationLabel}.`);
    this.name = "SessionLifecycleBusyError";
  }
}

const activeLifecycleOperations = new Map<string, SessionLifecycleOperation>();

async function withSessionLifecycleLocks<T>(
  sessionIds: string[],
  operation: SessionLifecycleOperation,
  task: () => Promise<T>,
): Promise<T> {
  const uniqueSessionIds = [...new Set(sessionIds)];
  const busySessionId = uniqueSessionIds.find((sessionId) =>
    activeLifecycleOperations.has(sessionId),
  );
  if (busySessionId) {
    throw new SessionLifecycleBusyError(busySessionId, operation);
  }

  for (const sessionId of uniqueSessionIds) {
    activeLifecycleOperations.set(sessionId, operation);
  }
  try {
    return await task();
  } finally {
    for (const sessionId of uniqueSessionIds) {
      activeLifecycleOperations.delete(sessionId);
    }
  }
}

async function withSessionLifecycleLock<T>(
  sessionId: string,
  operation: SessionLifecycleOperation,
  task: () => Promise<T>,
): Promise<T> {
  return withSessionLifecycleLocks([sessionId], operation, task);
}

function sessionHistoryController(sessionId: string) {
  return createNotificationHistoryController({
    sessionId,
    loadSegment: (segmentId) =>
      request.getSessionHistorySegment(
        segmentId === undefined ? { sessionId } : { sessionId, segmentId },
      ),
    initialLoadError: () => new Error("Session history is unavailable."),
    previousLoadError: () => new Error("Session history segment is unavailable."),
  });
}

function finishLoadingSession(sessionId: string): void {
  sessionHistoryController(sessionId).finishLoading();
}

function restoreSessionHistory(sessionId: string, keepLoading: boolean): Promise<Set<string>> {
  return sessionHistoryController(sessionId).loadInitial({ keepLoading });
}

export function loadPreviousSessionHistory(sessionId: string): Promise<boolean> {
  return withSessionLifecycleLock(sessionId, "history", () =>
    sessionHistoryController(sessionId).loadPrevious(),
  );
}

export interface LoadSessionOptions {
  force?: boolean;
  loadHistory?: boolean;
}

export async function loadSession(
  sessionId: string,
  { force = false, loadHistory = false }: LoadSessionOptions = {},
): Promise<void> {
  return withSessionLifecycleLock(sessionId, "load", async () => {
    let loadingStarted = false;
    try {
      if (loadHistory) {
        useAppStore.getState().updateSessionState(sessionId, (currentState) => ({
          ...reduceFlushStreaming(currentState),
          isLoading: true,
        }));
        loadingStarted = true;
      }

      await request.loadSession({ sessionId, force });
      if (loadHistory) {
        await restoreSessionHistory(sessionId, false);
        useAppStore.getState().updateSessionState(sessionId, () => ({
          loadedAt: Date.now(),
        }));
      }
    } catch (error) {
      if (loadingStarted) finishLoadingSession(sessionId);
      throw error;
    }
  });
}

export interface RestartSessionOptions {
  session: SessionInfo;
  mcpServers?: SessionInfo["mcpServers"];
  features?: SessionInfo["features"];
  /**
   * 权限模式。仅在显式传入时写入 storage——
   * 会话头部是即时 `updateSession`（不传），加载失败页则随「重新加载」一起提交（传）。
   */
  permissionMode?: SessionInfo["permissionMode"];
}

export async function restartSession(options: RestartSessionOptions): Promise<void> {
  return withSessionLifecycleLock(options.session.id, "restart", async () => {
    const {
      session,
      mcpServers = session.mcpServers,
      features = session.features,
      permissionMode,
    } = options;
    let loadingStarted = false;

    try {
      const store = useAppStore.getState();
      store.updateSessionState(session.id, (currentState) => ({
        ...reduceFlushStreaming(currentState),
        isLoading: true,
      }));
      loadingStarted = true;

      try {
        await request.updateSession({
          sessionId: session.id,
          mcpServers,
          features,
          ...(permissionMode !== undefined ? { permissionMode } : {}),
        });
      } catch (error) {
        throw new RestartSessionError("update", error);
      }

      const currentSession =
        useAppStore.getState().sessions.find((item) => item.id === session.id) ?? session;
      store.updateSession({
        ...currentSession,
        mcpServers,
        features,
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        isStreaming: false,
      });

      let historyDisplayIds: Set<string>;
      try {
        historyDisplayIds = await restoreSessionHistory(session.id, true);
        await request.loadSession({ sessionId: session.id, force: true });
      } catch (error) {
        throw new RestartSessionError("load", error);
      }

      useAppStore.getState().updateSessionState(session.id, (currentState) => {
        const { state, applied } = reduceNotifications(
          session.id,
          currentState,
          currentState.pendingNotifications,
          historyDisplayIds,
        );
        return {
          ...reduceFlushStreaming(state),
          liveHistoryNotifications: [...currentState.liveHistoryNotifications, ...applied],
          pendingNotifications: [],
          isLoading: false,
          loadedAt: Date.now(),
        };
      });
    } catch (error) {
      if (loadingStarted) finishLoadingSession(session.id);
      throw error;
    }
  });
}

export function closeSession(sessionId: string): Promise<void> {
  return withSessionLifecycleLock(sessionId, "close", async () => {
    await request.closeSession({ sessionId });
    finishLoadingSession(sessionId);
  });
}

export function deleteProject(projectId: string, sessionIds: string[]): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "delete", () => request.deleteProject(projectId));
}

export function deleteSessions(sessionIds: string[]): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "delete", async () => {
    for (const sessionId of sessionIds) {
      await request.deleteSession(sessionId);
    }
  });
}

export function deleteSession(sessionId: string): Promise<void> {
  return deleteSessions([sessionId]);
}

export function updateAgentSettings(agents: AgentInfo[], sessionIds: string[]): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "reset", () => request.updateSettings({ agents }));
}

export function resetAgent(agentId: string, sessionIds: string[]): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "reset", () => request.resetAgent({ agentId }));
}

export function clearAgentSessions(
  agentId: string,
  sessionIds: string[],
): Promise<{ deletedSessionIds: string[] }> {
  return withSessionLifecycleLocks(sessionIds, "delete", () =>
    request.clearAgentSessions({ agentId }),
  );
}

export interface NewSessionOptions {
  projectId: string;
  agentId: string;
  mcpServers?: string[];
  features?: Feature[];
  permissionMode?: "ask" | "allow-all";
}

export async function newSession(options: NewSessionOptions): Promise<string> {
  const result = await request.newSession(options);
  useAppStore.getState().updateSessionState(result.sessionId, () => ({
    isLoading: false,
    loadedAt: Date.now(),
  }));
  return result.sessionId;
}

/**
 * 手动重命名会话。
 *
 * 写入的是「用户标题」（`userTitle`）：一旦设置，Agent 后续的标题变更会被忽略。
 * 传空串表示清除用户标题，回落到 Agent / 自动标题。
 */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  await request.updateSession({ sessionId, userTitle: title.trim() || null });
}
