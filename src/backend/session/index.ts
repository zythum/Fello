import { randomUUID } from "crypto";
import type {
  ContentBlock,
  SessionNotification,
  InitializeResponse,
  Usage,
} from "@agentclientprotocol/sdk";
import type { BackendContext } from "../types";
import type { BridgePoolModule } from "../bridge-pool";
import type { AskUserModule } from "../ask-user";
import type { ShareToUserModule } from "../share-to-user";
import type { SkillsModule } from "../skills";
import type { SearchModule } from "../search";
import type {
  Feature,
  ProjectInfo,
  SessionModelState,
  SessionModeState,
  SessionNotificationFelloExt,
  FelloIPCSchema,
} from "../../shared/schema";
import { ALL_FEATURES } from "../../shared/constants";
import { startSocketServer, generateSocketPath, type SocketServer } from "../socket-server";
import { writeActiveSessionId } from "../ilink/ilink-bridge";
import { t } from "../i18n";
import { buildMcpServersConfig, type McpConfigDeps } from "./mcp-config";
import { createNotificationHandler } from "./notifications";
import type { IlinkState } from "../ilink";

// ── Types ────────────────────────────────────────────────────────────

export interface SessionResult {
  sessionId: string;
  initializeInfo: InitializeResponse | null;
  models: SessionModelState | null;
  modes: SessionModeState | null;
}

export interface SessionModule {
  broadcastAndSaveSessionUpdate: (sessionId: string, notification: SessionNotification) => void;
  clearSession: () => void;
  newSession: (params: {
    projectId: string;
    agentId: string;
    mcpServers?: string[];
    permissionMode?: "ask" | "allow-all";
    features?: Feature[];
  }) => Promise<SessionResult>;
  loadSession: (params: { sessionId: string; force?: boolean }) => Promise<SessionResult>;
  getSessionHistory: (params: {
    sessionId: string;
  }) => Promise<{ messages: SessionNotificationFelloExt[] }>;
  sendPrompt: (params: {
    sessionId: string;
    contents: ContentBlock[];
  }) => Promise<{ stopReason: string; usage?: Usage | null }>;
  cancelPrompt: (params: { sessionId: string }) => Promise<void>;
  updateSession: (params: { sessionId: string; [key: string]: unknown }) => Promise<void>;
  changeWorkDir: () => Promise<{ ok: boolean; cwd: null }>;
  deleteSession: (sessionId: string) => Promise<void>;
  resetAgentSessions: (agentId: string) => Promise<number>;
  deleteAgentSessions: (agentId: string) => Promise<string[]>;
  getModels: (params: { sessionId: string }) => Promise<SessionModelState | null>;
  setModel: (params: { sessionId: string; modelId: string }) => Promise<void>;
  getModes: (params: { sessionId: string }) => Promise<SessionModeState | null>;
  setMode: (params: { sessionId: string; modeId: string }) => Promise<void>;
}

export interface SessionDeps {
  bridgePool: BridgePoolModule;
  askUser: AskUserModule;
  shareToUser: ShareToUserModule;
  skills: SkillsModule;
  search: SearchModule;
  ilink: IlinkState;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createSessionModule(ctx: BackendContext, deps: SessionDeps): SessionModule {
  const { sendEvent, storage } = ctx;
  const { bridgePool, askUser, shareToUser, skills, search, ilink: ilinkState } = deps;

  const mcpDeps: McpConfigDeps = { skills, askUser, shareToUser, search };
  const notif = createNotificationHandler(ctx, { ilink: ilinkState });

  // Wire broadcastAndSaveSessionUpdate into bridgePool
  bridgePool.setBroadcast(notif.broadcastAndSaveSessionUpdate);

  // ── Session Socket Servers ─────────────────────────────────────────

  const sessionSocketServers = new Map<string, SocketServer>();

  async function createSessionSocketServer(
    sessionId: string,
    options: { socketPath: string; project: ProjectInfo },
  ): Promise<SocketServer> {
    const existing = sessionSocketServers.get(sessionId);
    if (existing && existing.socketPath === options.socketPath) return existing;
    if (existing) {
      existing.stop();
      sessionSocketServers.delete(sessionId);
    }
    const server = await startSocketServer(options.socketPath);
    askUser.registerAskUserRoute(server, sessionId);
    skills.registerSkillsRoute(server, options.project.cwd);
    shareToUser.registerShareToUserRoute(server, sessionId);
    search.registerSearchRoute(server, options.project.cwd);
    sessionSocketServers.set(sessionId, server);
    return server;
  }

  function stopSessionSocketServer(sessionId: string) {
    const ss = sessionSocketServers.get(sessionId);
    if (ss) ss.stop();
    sessionSocketServers.delete(sessionId);
  }

  // ── Handlers ───────────────────────────────────────────────────────

  function clearSession() {
    for (const ss of sessionSocketServers.values()) ss.stop();
    sessionSocketServers.clear();
    notif.clear();
  }

  async function newSession({
    projectId,
    agentId,
    mcpServers,
    permissionMode,
    features,
  }: {
    projectId: string;
    agentId: string;
    mcpServers?: string[];
    permissionMode?: "ask" | "allow-all";
    features?: Feature[];
  }) {
    const project = storage.getProject(projectId);
    if (!project) throw new Error("Project does not exist");
    const b = await bridgePool.ensureBridge(agentId);

    const socketPath = generateSocketPath(randomUUID());
    const sessionMcpIds =
      mcpServers ??
      (storage.getSettings().mcpServers || []).filter((s) => !s.disabled).map((s) => s.id);
    const effectiveFeatures: Feature[] = features ?? ALL_FEATURES;
    const activeMcpServers = buildMcpServersConfig(
      sessionMcpIds,
      { project, socketPath, features: effectiveFeatures },
      ctx,
      mcpDeps,
    );

    const {
      sessionId: resumeId,
      models,
      modes,
    } = await b.newSession({ cwd: project.cwd, mcpServers: activeMcpServers });
    const sessionInfo = storage.createSession(project.id, resumeId, agentId, {
      mcpServers: sessionMcpIds,
      features: effectiveFeatures,
      permissionMode: permissionMode ?? "ask",
      models: models ?? null,
      modes: modes ?? null,
      initializeInfo: b.initializeInfo,
    });

    await createSessionSocketServer(sessionInfo.id, { socketPath, project });
    sendEvent("sessions-changed", undefined);
    return {
      sessionId: sessionInfo.id,
      initializeInfo: b.initializeInfo,
      models: models ?? null,
      modes: modes ?? null,
    };
  }

  async function loadSession({ sessionId, force }: { sessionId: string; force?: boolean }) {
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const project = storage.getProject(session.projectId);
    if (!project) throw new Error("Project does not exist");

    const b = await bridgePool.ensureBridge(session.agentId);

    if (b.isSessionLoaded(session.resumeId) && !force) {
      return {
        sessionId: session.id,
        initializeInfo: b.initializeInfo,
        models: b.getModelState(session.resumeId) ?? session.models,
        modes: b.getModeState(session.resumeId) ?? session.modes,
      };
    }

    if (session.isStreaming) {
      storage.updateSession(sessionId, { isStreaming: false });
      session.isStreaming = false;
      sendEvent("session-changed", { session });
    }

    const existingSocketServer = sessionSocketServers.get(session.id);
    const socketPath = existingSocketServer
      ? existingSocketServer.socketPath
      : generateSocketPath(randomUUID());
    const activeMcpServers = buildMcpServersConfig(
      session.mcpServers,
      { project, socketPath, features: session.features },
      ctx,
      mcpDeps,
    );

    if (b.isSessionLoaded(session.resumeId)) {
      console.log(`[Fello] Session ${session.resumeId} force reloading...`);
      await b.closeSession(session.resumeId);
      await stopSessionSocketServer(session.id);
    }

    notif.addRestoring(session.id);
    let loadResult;
    try {
      loadResult = await b.loadSession({
        sessionId: session.resumeId,
        cwd: session.cwd,
        mcpServers: activeMcpServers,
      });
      await createSessionSocketServer(session.id, { socketPath, project });
    } finally {
      notif.removeRestoring(session.id);
    }

    let finalModels = loadResult?.models ?? null;
    let finalModes = loadResult?.modes ?? null;
    let shouldUpdateCache = false;

    if (finalModels) {
      shouldUpdateCache = true;
    } else {
      const c = b.getModelState(session.resumeId);
      if (c) {
        finalModels = c;
        shouldUpdateCache = true;
      } else finalModels = session.models;
    }

    if (finalModes) {
      shouldUpdateCache = true;
    } else {
      const c = b.getModeState(session.resumeId);
      if (c) {
        finalModes = c;
        shouldUpdateCache = true;
      } else finalModes = session.modes;
    }

    if (shouldUpdateCache || b.initializeInfo) {
      storage.updateSession(
        session.id,
        { models: finalModels, modes: finalModes, initializeInfo: b.initializeInfo },
        false,
      );
    }

    const freshSession = storage.getSession(session.id);
    if (freshSession) sendEvent("session-changed", { session: freshSession });

    return {
      sessionId: session.id,
      initializeInfo: b.initializeInfo,
      models: finalModels,
      modes: finalModes,
    };
  }

  async function getSessionHistory({ sessionId }: { sessionId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    return { messages: notif.mergeNotifications(storage.readSessionMessages(sessionId)) };
  }

  async function sendPrompt({
    sessionId,
    contents,
  }: {
    sessionId: string;
    contents: ContentBlock[];
  }) {
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const project = storage.getProject(session.projectId);
    if (!project) throw new Error("Project does not exist");

    if (session.isStreaming) {
      console.log(
        `[Fello] Session ${sessionId} is already streaming, cancelling previous generation...`,
      );
      const connectPromise = bridgePool.pool.get(session.agentId);
      if (connectPromise) {
        // Cancel pending ask-user requests
        const pending = await askUser.getPendingAskUserRequests({ sessionId });
        for (const req of pending) {
          try {
            await askUser.respondAskUser({
              sessionId,
              askUserId: req.askUserId,
              value: null,
              reason: "",
            });
          } catch (err) {
            console.warn("[SendPrompt] Respond Previous Ask User Error", err);
          }
        }
        const b = await connectPromise;
        await b.cancel({ sessionId: session.resumeId }).catch((err) => {
          console.warn(
            `[Fello] Failed to cancel previous generation for session ${sessionId}: ${err}`,
          );
        });
        const killed = b.terminalManager.killBySession(session.resumeId);
        if (killed > 0)
          console.log(
            `[SendPrompt] Killed ${killed} agent terminal(s) from previous generation for session ${sessionId}`,
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    if (!session.title) {
      const firstTextContent = contents.find((c) => c.type === "text");
      if (firstTextContent && firstTextContent.type === "text" && firstTextContent.text) {
        let fallbackTitle = firstTextContent.text.trim().split("\n")[0].substring(0, 30);
        if (firstTextContent.text.length > 30) fallbackTitle += "...";
        storage.updateSession(sessionId, { title: fallbackTitle });
      }
    }

    const b = await bridgePool.ensureBridge(session.agentId);

    if (!b.isSessionLoaded(session.resumeId)) {
      console.log(`[Fello] Session ${session.resumeId} not loaded in Agent, lazy loading...`);
      const socketPath = generateSocketPath(randomUUID());
      const activeMcpServers = buildMcpServersConfig(
        session.mcpServers,
        { project, socketPath, features: session.features },
        ctx,
        mcpDeps,
      );
      await b.loadSession({
        sessionId: session.resumeId,
        cwd: session.cwd,
        mcpServers: activeMcpServers,
      });
      await createSessionSocketServer(session.id, { socketPath, project });
    }

    storage.updateSession(sessionId, { isStreaming: true });
    const updated = storage.getSession(sessionId);
    if (updated) sendEvent("session-changed", { session: updated });
    sendEvent("prompt-start", { sessionId });

    const ilinkBridge = ilinkState.getBridge();
    const ilinkActiveSessionId = ilinkState.getActiveSessionId();
    if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
      const userId = ilinkBridge.userId;
      if (userId) ilinkBridge.sendTyping(userId, true).catch(() => {});
    }

    for (const content of contents) {
      const notification: SessionNotification = {
        sessionId: session.resumeId,
        update: { sessionUpdate: "user_message_chunk", content },
      };
      notif.broadcastAndSaveSessionUpdate(session.id, notification);
    }

    let promptResponse: { stopReason: string; usage?: Usage | null } | undefined;
    let promptError: string | undefined;
    try {
      promptResponse = await b.sendPrompt({ sessionId: session.resumeId, prompt: contents });
      return promptResponse;
    } catch (err) {
      promptError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      sendEvent("prompt-end", {
        sessionId,
        stopReason:
          promptResponse?.stopReason as FelloIPCSchema["events"]["prompt-end"]["stopReason"],
        error: promptError,
      });
      storage.updateSession(sessionId, { isStreaming: false });
      const updated2 = storage.getSession(sessionId);
      if (updated2) sendEvent("session-changed", { session: updated2 });

      const bridge = ilinkState.getBridge();
      const activeId = ilinkState.getActiveSessionId();
      if (bridge?.isConnected && sessionId === activeId) {
        const userId = bridge.userId;
        if (userId) {
          bridge.sendTyping(userId, false).catch(() => {});
          const bufferedText = ilinkState.getReplyBuffer();
          ilinkState.setReplyBuffer("");
          const flushPromise = bufferedText
            ? bridge.sendTextReply(userId, bufferedText).catch((err) => {
                console.warn("[iLink] Failed to forward reply to WeChat:", err);
              })
            : Promise.resolve();
          if (promptError) {
            flushPromise.then(() =>
              bridge
                .sendTextReply(userId, t("ilink.promptError", { error: promptError }))
                .catch(() => {}),
            );
          } else if (promptResponse?.stopReason && promptResponse.stopReason !== "end_turn") {
            const stopReasonLabels: Record<string, string> = {
              max_tokens: t("ilink.promptMaxTokens"),
              max_turn_requests: t("ilink.promptMaxTurnRequests"),
              refusal: t("ilink.promptRefusal"),
              cancelled: t("ilink.promptCancelled"),
            };
            const label = stopReasonLabels[promptResponse.stopReason] || promptResponse.stopReason;
            flushPromise.then(() => bridge.sendTextReply(userId, label).catch(() => {}));
          }
          notif.flushIlinkMedia(bridge);
        }
      }
    }
  }

  async function cancelPrompt({ sessionId }: { sessionId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) return;
    const pending = await askUser.getPendingAskUserRequests({ sessionId });
    for (const req of pending) {
      try {
        await askUser.respondAskUser({
          sessionId,
          askUserId: req.askUserId,
          value: null,
          reason: "",
        });
      } catch (err) {
        console.warn("[CancelPrompt] Respond Previous Ask User Error", err);
      }
    }
    const connectPromise = bridgePool.pool.get(session.agentId);
    if (connectPromise) {
      const b = await connectPromise;
      await b.cancel({ sessionId: session.resumeId });
      const killed = b.terminalManager.killBySession(session.resumeId);
      if (killed > 0)
        console.log(`[CancelPrompt] Killed ${killed} agent terminal(s) for session ${sessionId}`);
    }
  }

  async function updateSession({
    sessionId,
    ...updates
  }: {
    sessionId: string;
    [key: string]: unknown;
  }) {
    storage.updateSession(sessionId, updates);
    const session = storage.getSession(sessionId);
    if (session) sendEvent("session-changed", { session });
  }

  async function changeWorkDir() {
    return { ok: false, cwd: null };
  }

  async function deleteSession(sessionId: string) {
    const session = storage.getSession(sessionId);
    if (session) {
      try {
        const b = await bridgePool.ensureBridge(session.agentId);
        if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
        await b.deleteSession(session.resumeId);
      } catch (error) {
        console.warn(
          `[backend] Failed to close/delete session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    storage.deleteSession(sessionId);
    stopSessionSocketServer(sessionId);

    if (ilinkState.getActiveSessionId() === sessionId) {
      // Clear ilink active session via external setter (will be wired in backend.ts)
      ilinkState.setReplyBuffer("");
      try {
        await writeActiveSessionId(null);
      } catch (error) {
        console.warn("[iLink] Failed to clear persisted active session:", error);
      }
      sendEvent("ilink-active-session-changed", { sessionId: null });
    }

    sendEvent("sessions-changed", undefined);
  }

  async function resetAgentSessions(agentId: string): Promise<number> {
    const sessions = storage.listSessions().filter((s) => s.agentId === agentId);
    for (const session of sessions) {
      try {
        const connectPromise = bridgePool.pool.get(session.agentId);
        if (connectPromise) {
          const b = await connectPromise;
          if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
        }
      } catch (error) {
        console.warn(
          `[backend] Failed to close session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      stopSessionSocketServer(session.id);
    }
    if (sessions.length > 0) sendEvent("sessions-changed", undefined);
    return sessions.length;
  }

  async function deleteAgentSessions(agentId: string): Promise<string[]> {
    const sessions = storage.listSessions().filter((s) => s.agentId === agentId);
    const ids = sessions.map((s) => s.id);
    for (const session of sessions) {
      try {
        const b = await bridgePool.ensureBridge(session.agentId);
        if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
        await b.deleteSession(session.resumeId);
      } catch (error) {
        console.warn(
          `[backend] Failed to close/delete session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      storage.deleteSession(session.id);
      stopSessionSocketServer(session.id);

      if (ilinkState.getActiveSessionId() === session.id) {
        ilinkState.setReplyBuffer("");
        try {
          await writeActiveSessionId(null);
        } catch (error) {
          console.warn("[iLink] Failed to clear persisted active session:", error);
        }
        sendEvent("ilink-active-session-changed", { sessionId: null });
      }
    }
    if (sessions.length > 0) sendEvent("sessions-changed", undefined);
    return ids;
  }

  async function getModels({ sessionId }: { sessionId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.pool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModelState(session.resumeId);
  }

  async function setModel({ sessionId, modelId }: { sessionId: string; modelId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.pool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionModel({ sessionId: session.resumeId, modelId });
    if (session.models) {
      session.models.currentModelId = modelId;
      storage.updateSession(session.id, { models: session.models });
      const updated = storage.getSession(session.id);
      if (updated) sendEvent("session-changed", { session: updated });
    }
  }

  async function getModes({ sessionId }: { sessionId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) return null;
    const connectPromise = bridgePool.pool.get(session.agentId);
    if (!connectPromise) return null;
    const b = await connectPromise;
    return b.getModeState(session.resumeId);
  }

  async function setMode({ sessionId, modeId }: { sessionId: string; modeId: string }) {
    const session = storage.getSession(sessionId);
    if (!session) throw new Error("Session does not exist");
    const connectPromise = bridgePool.pool.get(session.agentId);
    if (!connectPromise) throw new Error("Agent bridge not found for session");
    const b = await connectPromise;
    await b.setSessionMode({ sessionId: session.resumeId, modeId });
    if (session.modes) {
      session.modes.currentModeId = modeId;
      storage.updateSession(session.id, { modes: session.modes });
      const updated = storage.getSession(session.id);
      if (updated) sendEvent("session-changed", { session: updated });
    }
  }

  return {
    broadcastAndSaveSessionUpdate: notif.broadcastAndSaveSessionUpdate,
    clearSession,
    newSession,
    loadSession,
    getSessionHistory,
    sendPrompt,
    cancelPrompt,
    updateSession,
    changeWorkDir,
    deleteSession,
    resetAgentSessions,
    deleteAgentSessions,
    getModels,
    setModel,
    getModes,
    setMode,
  };
}
