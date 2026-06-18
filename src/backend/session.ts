import { omit } from "es-toolkit";
import { randomUUID } from "crypto";
import type {
  SessionNotification,
  PromptResponse,
  ContentBlock,
  ToolCallUpdate,
  McpServer,
} from "@agentclientprotocol/sdk";
import { storageOps } from "./storage";
import { ensureBridge, bridgePool } from "./session-agent-bridge";
import { startSocketServer, generateSocketPath, type SocketServer } from "./socket-server";
import { buildSkillsMcpServer, registerSkillsRoute } from "./skills";
import {
  buildAskUserMcpServer,
  pendingAskUserRequests,
  respondAskUser,
  registerAskUserRoute,
} from "./ask-user";
import { buildShareToUserMcpServer, registerShareToUserRoute } from "./share-to-user";
import {
  getIlinkBridge,
  getIlinkActiveSessionId,
  getIlinkReplyBuffer,
  setIlinkReplyBuffer,
  setIlinkActiveSessionId,
  appendIlinkReplyBuffer,
} from "./ilink-state";
import { writeActiveSessionId } from "./ilink/ilink-bridge";

import type {
  FelloIPCSchema,
  Feature,
  ProjectInfo,
  SessionNotificationFelloExt,
} from "../shared/schema";
import { ALL_FEATURES } from "../shared/constants";
import { t } from "./i18n";

// ── Session Socket Servers ───────────────────────────────────────────

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
  registerAskUserRoute(server, sessionId);
  registerSkillsRoute(server, options.project.cwd);
  registerShareToUserRoute(server, sessionId);
  sessionSocketServers.set(sessionId, server);
  return server;
}

function stopSessionSocketServer(sessionId: string) {
  const ss = sessionSocketServers.get(sessionId);
  if (ss) ss.stop();
  sessionSocketServers.delete(sessionId);
}

export function clearSession() {
  for (const ss of sessionSocketServers.values()) ss.stop();
  sessionSocketServers.clear();
  restoringSessions.clear();
  pendingToolCalls.clear();
}

// ── MCP Config Builder ───────────────────────────────────────────────

function buildMcpServersConfig(
  sessionMcpIds: string[],
  options: { project: ProjectInfo; socketPath: string | null; features?: Feature[] },
): McpServer[] {
  const { project, socketPath, features = ALL_FEATURES } = options;
  const servers: McpServer[] = [];

  if (socketPath && features.includes("skills")) {
    servers.push(buildSkillsMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("ask_user")) {
    servers.push(buildAskUserMcpServer({ projectDir: project.cwd, socketPath }));
  }

  if (socketPath && features.includes("share_to_user")) {
    servers.push(buildShareToUserMcpServer({ projectDir: project.cwd, socketPath }));
  }

  const globalSettings = storageOps.getSettings();
  for (const id of sessionMcpIds) {
    const config = globalSettings.mcpServers?.find((s) => s.id === id);
    if (config) {
      if (config.type === "stdio") {
        servers.push({
          name: id,
          command: config.command,
          args: config.args,
          env: Object.entries(config.env).map(([k, v]) => ({ name: k, value: v })),
        });
      } else if (config.type === "http") {
        servers.push({
          type: "http",
          name: id,
          url: config.url,
          headers: Object.entries(config.headers).map(([k, v]) => ({ name: k, value: v })),
        });
      }
    }
  }
  return servers;
}

// ── State ────────────────────────────────────────────────────────────

const restoringSessions = new Set<string>();

const pendingToolCalls = new Map<string, ToolCallUpdate>();

function getPendingToolCallKey(sessionId: string, toolCallId: string) {
  return `${sessionId}:${toolCallId}`;
}

let sendEvent: <K extends keyof FelloIPCSchema["events"]>(
  channel: K,
  payload: FelloIPCSchema["events"][K],
) => boolean = () => false;

export function initSession(emitter: typeof sendEvent) {
  sendEvent = emitter;
}

// ── Notification Handling ────────────────────────────────────────────

function mergeToolCallUpdate<T extends ToolCallUpdate>(base: ToolCallUpdate, update: T): T {
  const merged: ToolCallUpdate = { ...base };
  if (Object.prototype.hasOwnProperty.call(update, "title")) merged.title = update.title;
  if (Object.prototype.hasOwnProperty.call(update, "status") && update.status != null)
    merged.status = update.status;
  if (Object.prototype.hasOwnProperty.call(update, "content")) merged.content = update.content;
  if (Object.prototype.hasOwnProperty.call(update, "kind") && update.kind != null)
    merged.kind = update.kind;
  if (Object.prototype.hasOwnProperty.call(update, "rawInput")) merged.rawInput = update.rawInput;
  if (Object.prototype.hasOwnProperty.call(update, "locations"))
    merged.locations = update.locations;
  if (Object.prototype.hasOwnProperty.call(update, "rawOutput"))
    merged.rawOutput = update.rawOutput;
  if (Object.prototype.hasOwnProperty.call(update, "_meta")) merged._meta = update._meta;
  return merged as T;
}

export function broadcastAndSaveSessionUpdate(
  sessionId: string,
  notification: SessionNotification,
) {
  const sessionUpdate = notification.update?.sessionUpdate;

  // Block agent replay during loadSession (except metadata updates)
  if (
    restoringSessions.has(sessionId) &&
    sessionUpdate !== "available_commands_update" &&
    sessionUpdate !== "usage_update"
  ) {
    return;
  }

  const enrichedNotification: SessionNotificationFelloExt = {
    ...notification,
    update: {
      ...notification.update,
      _meta: {
        ...notification.update?._meta,
        fello: { receivedAt: Date.now(), displayId: randomUUID() },
      },
    },
  };

  const enrichedUpdate = enrichedNotification.update;

  // iLink forwarding: agent response → WeChat
  const ilinkBridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const userId = ilinkBridge.userId;
    if (userId) {
      if (enrichedUpdate.sessionUpdate === "agent_message_chunk") {
        const content = enrichedUpdate.content;
        if (content?.type === "text" && content.text) {
          appendIlinkReplyBuffer(content.text);
        }
      }
    }
  }

  // Flush buffered text before tool call
  if (
    sessionUpdate === "tool_call" &&
    ilinkBridge?.isConnected &&
    sessionId === ilinkActiveSessionId
  ) {
    const userId = ilinkBridge.userId;
    const buffer = getIlinkReplyBuffer();
    if (userId && buffer) {
      setIlinkReplyBuffer("");
      ilinkBridge.sendTextReply(userId, buffer).catch((err) => {
        console.warn("[iLink] Failed to forward pre-tool text to WeChat:", err);
      });
    }
  }

  if (sessionUpdate === "tool_call_update") {
    const update = enrichedNotification.update as unknown as ToolCallUpdate;
    const toolCallId = update.toolCallId;
    const key = getPendingToolCallKey(sessionId, toolCallId);
    const base = pendingToolCalls.get(key);

    if (update.status === "in_progress") {
      if (base) {
        pendingToolCalls.set(key, mergeToolCallUpdate(base, update));
      } else {
        pendingToolCalls.set(key, { ...update });
      }
    } else {
      if (base) {
        enrichedNotification.update = mergeToolCallUpdate(
          base,
          update,
        ) as SessionNotificationFelloExt["update"];
        pendingToolCalls.delete(key);
      }
      storageOps.appendSessionMessage(sessionId, {
        ...enrichedNotification,
        update: omit(enrichedNotification.update as any, ["rawInput", "rawOutput"]),
      } as SessionNotificationFelloExt);
    }
  } else {
    storageOps.appendSessionMessage(sessionId, enrichedNotification);
  }

  sendEvent("session-update", { sessionId, notification: enrichedNotification });
}

function mergeNotifications(
  notifications: SessionNotificationFelloExt[],
): SessionNotificationFelloExt[] {
  const result: SessionNotificationFelloExt[] = [];

  for (const notification of notifications) {
    const update = notification.update;
    if (!update) {
      result.push(notification);
      continue;
    }

    const type = update.sessionUpdate;

    if (type === "agent_message_chunk" || type === "agent_thought_chunk") {
      const prev = result.length > 0 ? result[result.length - 1] : undefined;
      if (
        prev?.update?.sessionUpdate === type &&
        prev.update.content?.type === "text" &&
        update.content?.type === "text"
      ) {
        result[result.length - 1] = {
          ...prev,
          update: {
            ...prev.update,
            content: {
              ...prev.update.content,
              text: prev.update.content.text + update.content.text,
            },
          },
        };
        continue;
      }
    }

    if (type === "tool_call" || type === "tool_call_update") {
      const toolCallId = update.toolCallId;
      const idx = result.findIndex(
        (n) =>
          (n.update?.sessionUpdate === "tool_call" ||
            n.update?.sessionUpdate === "tool_call_update") &&
          (n.update as { toolCallId?: string }).toolCallId === toolCallId,
      );
      if (idx !== -1) {
        const prev = result[idx];
        result[idx] = {
          ...prev,
          update: { ...prev.update, ...update, sessionUpdate: "tool_call" },
        } as SessionNotificationFelloExt;
        continue;
      }
    }

    result.push(notification);
  }
  return result;
}

// ── Handlers ─────────────────────────────────────────────────────────

export async function newSession({
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
  const project = storageOps.getProject(projectId);
  if (!project) throw new Error("Project does not exist");
  const b = await ensureBridge(agentId);

  const socketPath = generateSocketPath(randomUUID());
  const sessionMcpIds =
    mcpServers ??
    (storageOps.getSettings().mcpServers || []).filter((s) => !s.disabled).map((s) => s.id);
  const effectiveFeatures: Feature[] = features ?? ALL_FEATURES;
  const activeMcpServers = buildMcpServersConfig(sessionMcpIds, {
    project,
    socketPath,
    features: effectiveFeatures,
  });

  const {
    sessionId: resumeId,
    models,
    modes,
  } = await b.newSession({ cwd: project.cwd, mcpServers: activeMcpServers });
  const sessionInfo = storageOps.createSession(project.id, resumeId, agentId, {
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

export async function loadSession({ sessionId, force }: { sessionId: string; force?: boolean }) {
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  const project = storageOps.getProject(session.projectId);
  if (!project) throw new Error("Project does not exist");

  const b = await ensureBridge(session.agentId);

  if (b.isSessionLoaded(session.resumeId) && !force) {
    return {
      sessionId: session.id,
      initializeInfo: b.initializeInfo,
      models: b.getModelState(session.resumeId) ?? session.models,
      modes: b.getModeState(session.resumeId) ?? session.modes,
    };
  }

  if (session.isStreaming) {
    storageOps.updateSession(sessionId, { isStreaming: false });
    session.isStreaming = false;
    sendEvent("session-changed", { session });
  }

  const existingSocketServer = sessionSocketServers.get(session.id);
  const socketPath = existingSocketServer
    ? existingSocketServer.socketPath
    : generateSocketPath(randomUUID());
  const activeMcpServers = buildMcpServersConfig(session.mcpServers, {
    project,
    socketPath,
    features: session.features,
  });

  if (b.isSessionLoaded(session.resumeId)) {
    console.log(`[Fello] Session ${session.resumeId} force reloading...`);
    await b.closeSession(session.resumeId);
    await stopSessionSocketServer(session.id);
  }

  restoringSessions.add(session.id);
  let loadResult;
  try {
    loadResult = await b.loadSession({
      sessionId: session.resumeId,
      cwd: session.cwd,
      mcpServers: activeMcpServers,
    });
    await createSessionSocketServer(session.id, { socketPath, project });
  } finally {
    restoringSessions.delete(session.id);
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
    } else {
      finalModels = session.models;
    }
  }

  if (finalModes) {
    shouldUpdateCache = true;
  } else {
    const c = b.getModeState(session.resumeId);
    if (c) {
      finalModes = c;
      shouldUpdateCache = true;
    } else {
      finalModes = session.modes;
    }
  }

  if (shouldUpdateCache || b.initializeInfo) {
    storageOps.updateSession(
      session.id,
      { models: finalModels, modes: finalModes, initializeInfo: b.initializeInfo },
      false,
    );
  }

  const freshSession = storageOps.getSession(session.id);
  if (freshSession) sendEvent("session-changed", { session: freshSession });

  return {
    sessionId: session.id,
    initializeInfo: b.initializeInfo,
    models: finalModels,
    modes: finalModes,
  };
}

export async function getSessionHistory({ sessionId }: { sessionId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  return { messages: mergeNotifications(storageOps.readSessionMessages(sessionId)) };
}

export async function sendPrompt({
  sessionId,
  contents,
}: {
  sessionId: string;
  contents: ContentBlock[];
}) {
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  const project = storageOps.getProject(session.projectId);
  if (!project) throw new Error("Project does not exist");

  if (session.isStreaming) {
    console.log(
      `[Fello] Session ${sessionId} is already streaming, cancelling previous generation...`,
    );
    const connectPromise = bridgePool.get(session.agentId);
    if (connectPromise) {
      for (const [askUserId, request] of Array.from(pendingAskUserRequests.entries())) {
        if (request.sessionId === sessionId) {
          try {
            await respondAskUser({ sessionId, askUserId, value: null, reason: "" });
          } catch (err) {
            console.warn("[SendPrompt] Respond Previous Ask User Error", err);
          }
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
      storageOps.updateSession(sessionId, { title: fallbackTitle });
    }
  }

  const b = await ensureBridge(session.agentId);

  if (!b.isSessionLoaded(session.resumeId)) {
    console.log(`[Fello] Session ${session.resumeId} not loaded in Agent, lazy loading...`);
    const socketPath = generateSocketPath(randomUUID());
    const activeMcpServers = buildMcpServersConfig(session.mcpServers, {
      project,
      socketPath,
      features: session.features,
    });
    await b.loadSession({
      sessionId: session.resumeId,
      cwd: session.cwd,
      mcpServers: activeMcpServers,
    });
    await createSessionSocketServer(session.id, { socketPath, project });
  }

  storageOps.updateSession(sessionId, { isStreaming: true });
  const updated = storageOps.getSession(sessionId);
  if (updated) sendEvent("session-changed", { session: updated });
  sendEvent("prompt-start", { sessionId });

  const ilinkBridge = getIlinkBridge();
  const ilinkActiveSessionId = getIlinkActiveSessionId();
  if (ilinkBridge?.isConnected && sessionId === ilinkActiveSessionId) {
    const userId = ilinkBridge.userId;
    if (userId) ilinkBridge.sendTyping(userId, true).catch(() => {});
  }

  for (const content of contents) {
    const notification: SessionNotification = {
      sessionId: session.resumeId,
      update: { sessionUpdate: "user_message_chunk", content },
    };
    broadcastAndSaveSessionUpdate(session.id, notification);
  }

  let promptResponse: PromptResponse | undefined;
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
      stopReason: promptResponse?.stopReason,
      error: promptError,
    });
    storageOps.updateSession(sessionId, { isStreaming: false });
    const updated = storageOps.getSession(sessionId);
    if (updated) sendEvent("session-changed", { session: updated });

    const bridge = getIlinkBridge();
    const activeId = getIlinkActiveSessionId();
    if (bridge?.isConnected && sessionId === activeId) {
      const userId = bridge.userId;
      if (userId) {
        bridge.sendTyping(userId, false).catch(() => {});
        const bufferedText = getIlinkReplyBuffer();
        setIlinkReplyBuffer("");
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
      }
    }
  }
}

export async function cancelPrompt({ sessionId }: { sessionId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) return;
  for (const [askUserId, request] of Array.from(pendingAskUserRequests.entries())) {
    if (request.sessionId === sessionId) {
      try {
        await respondAskUser({ sessionId, askUserId, value: null, reason: "" });
      } catch (err) {
        console.warn("[CancelPrompt] Respond Previous Ask User Error", err);
      }
    }
  }
  const connectPromise = bridgePool.get(session.agentId);
  if (connectPromise) {
    const b = await connectPromise;
    await b.cancel({ sessionId: session.resumeId });
    const killed = b.terminalManager.killBySession(session.resumeId);
    if (killed > 0)
      console.log(`[CancelPrompt] Killed ${killed} agent terminal(s) for session ${sessionId}`);
  }
}

export async function updateSession({
  sessionId,
  ...updates
}: {
  sessionId: string;
  [key: string]: any;
}) {
  storageOps.updateSession(sessionId, updates);
  const session = storageOps.getSession(sessionId);
  if (session) sendEvent("session-changed", { session });
}

export async function changeWorkDir() {
  return { ok: false, cwd: null };
}

export async function deleteSession(sessionId: string) {
  const session = storageOps.getSession(sessionId);

  if (session) {
    try {
      const b = await ensureBridge(session.agentId);
      if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
      // 通过 ACP session/delete 协议删除持久化会话目录
      await b.deleteSession(session.resumeId);
    } catch (error) {
      console.warn(
        `[backend] Failed to close/delete session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  storageOps.deleteSession(sessionId);
  stopSessionSocketServer(sessionId);

  if (getIlinkActiveSessionId() === sessionId) {
    setIlinkActiveSessionId(null);
    setIlinkReplyBuffer("");
    try {
      await writeActiveSessionId(null);
    } catch (error) {
      console.warn("[iLink] Failed to clear persisted active session:", error);
    }
    sendEvent("ilink-active-session-changed", { sessionId: null });
  }

  sendEvent("sessions-changed", undefined);
}

/**
 * 重置 Agent（轻量）：仅关闭在 bridge 上加载的会话，停止 socket 服务。
 * 不删除本地持久化数据（session 元数据、消息历史等）。
 * 用于 Agent 设置变更后或用户手动重置 Agent。
 */
export async function resetAgentSessions(agentId: string): Promise<number> {
  const sessions = storageOps.listSessions().filter((s) => s.agentId === agentId);
  for (const session of sessions) {
    try {
      const connectPromise = bridgePool.get(session.agentId);
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
  if (sessions.length > 0) {
    sendEvent("sessions-changed", undefined);
  }
  return sessions.length;
}

/**
 * 删除 Agent 的所有会话（彻底）：关闭 bridge 会话、删除 agent 端持久化数据、
 * 删除本地 session 元数据、停止 socket 服务。
 * 用于 Agent 被删除的场景。
 */
export async function deleteAgentSessions(agentId: string): Promise<string[]> {
  const sessions = storageOps.listSessions().filter((s) => s.agentId === agentId);
  const ids = sessions.map((s) => s.id);
  for (const session of sessions) {
    try {
      const b = await ensureBridge(session.agentId);
      if (b.isSessionLoaded(session.resumeId)) await b.closeSession(session.resumeId);
      await b.deleteSession(session.resumeId);
    } catch (error) {
      console.warn(
        `[backend] Failed to close/delete session on agent for ${session.agentId}:${session.resumeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    storageOps.deleteSession(session.id);
    stopSessionSocketServer(session.id);

    if (getIlinkActiveSessionId() === session.id) {
      setIlinkActiveSessionId(null);
      setIlinkReplyBuffer("");
      try {
        await writeActiveSessionId(null);
      } catch (error) {
        console.warn("[iLink] Failed to clear persisted active session:", error);
      }
      sendEvent("ilink-active-session-changed", { sessionId: null });
    }
  }
  if (sessions.length > 0) {
    sendEvent("sessions-changed", undefined);
  }
  return ids;
}

export async function getModels({ sessionId }: { sessionId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) return null;
  const connectPromise = bridgePool.get(session.agentId);
  if (!connectPromise) return null;
  const b = await connectPromise;
  return b.getModelState(session.resumeId);
}

export async function setModel({ sessionId, modelId }: { sessionId: string; modelId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  const connectPromise = bridgePool.get(session.agentId);
  if (!connectPromise) throw new Error("Agent bridge not found for session");
  const b = await connectPromise;
  await b.setSessionModel({ sessionId: session.resumeId, modelId });
  if (session.models) {
    session.models.currentModelId = modelId;
    storageOps.updateSession(session.id, { models: session.models });
    const updated = storageOps.getSession(session.id);
    if (updated) sendEvent("session-changed", { session: updated });
  }
}

export async function getModes({ sessionId }: { sessionId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) return null;
  const connectPromise = bridgePool.get(session.agentId);
  if (!connectPromise) return null;
  const b = await connectPromise;
  return b.getModeState(session.resumeId);
}

export async function setMode({ sessionId, modeId }: { sessionId: string; modeId: string }) {
  const session = storageOps.getSession(sessionId);
  if (!session) throw new Error("Session does not exist");
  const connectPromise = bridgePool.get(session.agentId);
  if (!connectPromise) throw new Error("Agent bridge not found for session");
  const b = await connectPromise;
  await b.setSessionMode({ sessionId: session.resumeId, modeId });
  if (session.modes) {
    session.modes.currentModeId = modeId;
    storageOps.updateSession(session.id, { modes: session.modes });
    const updated = storageOps.getSession(session.id);
    if (updated) sendEvent("session-changed", { session: updated });
  }
}
