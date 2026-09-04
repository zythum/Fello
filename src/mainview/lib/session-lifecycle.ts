import type { AgentInfo, Feature, SessionInfo } from "../../shared/schema";
import { request } from "../backend";
import { useAppStore, type SessionState } from "../store";
import { reduceFlushStreaming, reduceSessionNotification } from "./session-state-reducer";

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

export type SessionLifecycleOperation = "load" | "restart" | "close" | "delete" | "reset";

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

function applyPendingNotifications(
  sessionId: string,
  state: SessionState,
  pendingNotifications: SessionState["pendingNotifications"],
  knownDisplayIds?: Set<string>,
): SessionState {
  const displayIds = knownDisplayIds ?? new Set<string>();
  let nextState = state;

  for (const notification of pendingNotifications) {
    const displayId = notification.update._meta?.fello?.displayId;
    if (displayId && displayIds.has(displayId)) continue;
    if (displayId) displayIds.add(displayId);
    nextState = reduceSessionNotification(sessionId, nextState, notification);
  }

  return nextState;
}

function finishLoadingSession(sessionId: string): void {
  useAppStore.getState().updateSessionState(sessionId, (currentState) => {
    const state = applyPendingNotifications(
      sessionId,
      currentState,
      currentState.pendingNotifications,
    );
    return {
      ...reduceFlushStreaming(state),
      pendingNotifications: [],
      isLoading: false,
    };
  });
}

async function restoreSessionHistory(sessionId: string, keepLoading: boolean): Promise<Set<string>> {
  const result = await request.getSessionHistory({ sessionId });
  if (!result) {
    throw new Error("Session history is unavailable.");
  }

  const historyDisplayIds = new Set<string>();
  const store = useAppStore.getState();
  store.updateSessionState(sessionId, (currentState) => {
    let state: SessionState = {
      ...currentState,
      messages: [],
      activeToolCalls: new Map(),
      activeSubagents: new Map(),
    };

    for (const notification of result.messages) {
      const displayId = notification?.update?._meta?.fello?.displayId;
      if (displayId) historyDisplayIds.add(displayId);
      if (!notification?.update) continue;
      state = reduceSessionNotification(sessionId, state, notification);
    }

    state = applyPendingNotifications(
      sessionId,
      state,
      currentState.pendingNotifications,
      historyDisplayIds,
    );

    return {
      ...reduceFlushStreaming(state),
      isLoading: keepLoading,
      pendingNotifications: [],
    };
  });

  return historyDisplayIds;
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
}

export async function restartSession(options: RestartSessionOptions): Promise<void> {
  return withSessionLifecycleLock(options.session.id, "restart", async () => {
    const { session, mcpServers = session.mcpServers, features = session.features } = options;
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
        const state = applyPendingNotifications(
          session.id,
          currentState,
          currentState.pendingNotifications,
          historyDisplayIds,
        );
        return {
          ...reduceFlushStreaming(state),
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
  return withSessionLifecycleLocks(sessionIds, "delete", () =>
    request.deleteProject(projectId),
  );
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

export function updateAgentSettings(
  agents: AgentInfo[],
  sessionIds: string[],
): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "reset", () =>
    request.updateSettings({ agents }),
  );
}

export function resetAgent(agentId: string, sessionIds: string[]): Promise<void> {
  return withSessionLifecycleLocks(sessionIds, "reset", () =>
    request.resetAgent({ agentId }),
  );
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

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await request.updateSession({ sessionId, title });
}
