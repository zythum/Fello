import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { ContentBlock, SessionNotification, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type {
  ApiAgentInfo,
  AssistantStatus,
  SessionNotificationFelloExt,
} from "../../shared/schema";
import { ASSISTANT_AGENT_ID, ASSISTANT_SESSION_ID } from "../../assistant/constants";
import {
  appendAssistantMessage,
  type AssistantMessageSegment,
  beginAssistantMessageTurn,
  endAssistantMessageTurn,
  readAssistantMessageSegment,
} from "../../assistant/storage";
import { ACPBridge, type PromptResult } from "../agent/agent-bridge";
import { adapters, agentEnv, extNotificationSpecs } from "../acp-adapters/adapters";
import { FELLO_DIR } from "../storage/constant";
import type { BackendContext } from "../types";

export const ASSISTANT_WORKSPACE = join(FELLO_DIR, "workspaces", "__assistant__");

export interface AssistantModule {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getStatus: () => AssistantStatus;
  getHistorySegment: (params: {
    segmentId?: number;
  }) => ReturnType<typeof readAssistantMessageSegment>;
  sendPrompt: (contents: ContentBlock[]) => Promise<PromptResult>;
  cancelPrompt: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setThoughtLevel: (thoughtLevelId: string) => Promise<void>;
  refreshConfiguration: () => Promise<void>;
}

function mergeToolCallUpdate(base: ToolCallUpdate, update: ToolCallUpdate): ToolCallUpdate {
  const merged: ToolCallUpdate = { ...base };
  for (const key of [
    "title",
    "status",
    "kind",
    "rawInput",
    "locations",
    "rawOutput",
    "_meta",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(update, key) && update[key] != null) {
      Object.assign(merged, { [key]: update[key] });
    }
  }
  if (update.content?.length) {
    const types = new Set(update.content.map((item) => item.type));
    merged.content = [
      ...(merged.content ?? []).filter((item) => !types.has(item.type)),
      ...update.content,
    ];
  }
  return merged;
}

function findContentBlock(value: unknown): ContentBlock | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.type === "string" &&
    ["text", "image", "audio", "resource_link", "resource"].includes(item.type)
  )
    return item as unknown as ContentBlock;
  for (const child of Object.values(item)) {
    const found = findContentBlock(child);
    if (found) return found;
  }
  return null;
}

function getAssistantApiAgent(ctx: BackendContext, agentId: string): ApiAgentInfo | null {
  const agent = ctx.storage.getSettings().agents.find((item) => item.id === agentId);
  return agent?.type === "api" && agent.provider === "openai-compatible" && !agent.disabled
    ? agent
    : null;
}

function enrichNotification(notification: SessionNotification): SessionNotificationFelloExt {
  return {
    ...notification,
    update: {
      ...notification.update,
      _meta: {
        ...notification.update._meta,
        fello: {
          receivedAt: Date.now(),
          displayId: randomUUID(),
        },
      },
    },
  };
}

export function createAssistantModule(ctx: BackendContext): AssistantModule {
  let bridge: ACPBridge | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;
  let status: AssistantStatus = {
    connectionStatus: "disconnected",
    sourceAgentId: null,
    enabled: true,
    isStreaming: false,
    dreaming: false,
    models: null,
    thoughtLevels: null,
  };

  function publishStatus() {
    ctx.sendEvent("assistant-status-changed", { status });
  }

  function updateStatus(next: Partial<AssistantStatus>) {
    const { enabled, sourceAgentId } = ctx.storage.getSettings().assistant;
    status = { ...status, ...next, enabled, sourceAgentId };
    publishStatus();
  }

  const pendingToolCalls = new Map<string, ToolCallUpdate>();
  let activeMessageSegment: AssistantMessageSegment | null = null;
  let notificationTail = Promise.resolve();

  function queuePersistAndPublish(
    notification: SessionNotification,
    segment = activeMessageSegment,
  ): Promise<void> {
    const current = notificationTail.then(() => persistAndPublish(notification, segment));
    notificationTail = current.catch(() => {});
    return current;
  }

  async function persistAndPublish(
    notification: SessionNotification,
    segment: AssistantMessageSegment | null,
  ): Promise<void> {
    const enriched = enrichNotification(notification);
    const type = enriched.update.sessionUpdate;
    if (type === "usage_update" || type === "available_commands_update") {
      ctx.sendEvent("assistant-update", { notification: enriched });
      return;
    }
    if (type === "tool_call_update") {
      const update = enriched.update as ToolCallUpdate;
      const key = update.toolCallId;
      if (!update.content && update.rawOutput) {
        const content = findContentBlock(update.rawOutput);
        if (content) update.content = [{ type: "content", content }];
      }
      const prior = pendingToolCalls.get(key);
      if (update.status !== "completed" && update.status !== "failed") {
        pendingToolCalls.set(key, prior ? mergeToolCallUpdate(prior, update) : { ...update });
      } else {
        if (prior)
          enriched.update = mergeToolCallUpdate(
            prior,
            update,
          ) as SessionNotificationFelloExt["update"];
        pendingToolCalls.delete(key);
        const {
          rawInput: _rawInput,
          rawOutput: _rawOutput,
          ...safeUpdate
        } = enriched.update as ToolCallUpdate;
        await appendAssistantMessage(
          { ...enriched, update: safeUpdate as SessionNotificationFelloExt["update"] },
          segment ?? undefined,
        );
      }
    } else {
      await appendAssistantMessage(enriched, segment ?? undefined);
    }
    ctx.sendEvent("assistant-update", { notification: enriched });
  }

  async function getHistorySegment({ segmentId }: { segmentId?: number }) {
    return readAssistantMessageSegment(segmentId);
  }

  async function start(): Promise<void> {
    if (bridge?.isConnected) return;
    if (starting) return starting;

    starting = (async () => {
      const currentGeneration = ++generation;
      const { enabled, sourceAgentId } = ctx.storage.getSettings().assistant;
      if (!enabled) {
        updateStatus({
          connectionStatus: "disconnected",
          error: undefined,
          enabled: false,
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }
      const agentInfo = sourceAgentId ? getAssistantApiAgent(ctx, sourceAgentId) : null;
      if (!agentInfo) {
        updateStatus({
          connectionStatus: "error",
          error: sourceAgentId
            ? "The selected Personal Assistant agent is no longer enabled or compatible."
            : "Select an enabled OpenAI-compatible API agent to use Personal Assistant.",
          sourceAgentId,
          isStreaming: false,
          models: null,
          thoughtLevels: null,
        });
        return;
      }

      await mkdir(ASSISTANT_WORKSPACE, { recursive: true });
      if (generation !== currentGeneration) return;
      updateStatus({
        connectionStatus: "connecting",
        error: undefined,
        sourceAgentId,
        enabled: true,
      });

      const nextBridge = new ACPBridge(ASSISTANT_AGENT_ID, {
        agentInfo: {
          id: ASSISTANT_AGENT_ID,
          type: "assistant",
          sourceAgent: agentInfo,
          getDream: () => ctx.storage.getSettings().assistant.dream,
          onDreamStatus: ({ dreaming, error }) => {
            updateStatus({ dreaming, dreamError: error });
          },
        },
        cwd: ASSISTANT_WORKSPACE,
        extNotificationSpecs,
        agentEnv,
        onSessionConnect: () => {},
        onSessionUpdate: (notification) => {
          void queuePersistAndPublish(notification).catch((error) => {
            console.error("[assistant] Failed to persist notification:", error);
          });
        },
        onExtNotification: (method, params) => {
          for (const adapter of adapters) {
            const notifications = adapter.handleExtNotification(
              nextBridge,
              method,
              ASSISTANT_SESSION_ID,
              params,
            );
            if (notifications.length > 0) {
              for (const notification of notifications) {
                void queuePersistAndPublish(notification).catch((error) => {
                  console.error("[assistant] Failed to persist notification:", error);
                });
              }
              return;
            }
          }
        },
        onPermissionRequest: async () => ({
          outcome: { outcome: "selected", optionId: "deny" },
        }),
        onAgentTerminalOutput: () => {},
      });

      bridge = nextBridge;
      try {
        await nextBridge.connect();
        if (generation !== currentGeneration || bridge !== nextBridge) {
          await nextBridge.kill().catch(() => {});
          return;
        }
        const load = await nextBridge.loadSession({
          sessionId: ASSISTANT_SESSION_ID,
          cwd: ASSISTANT_WORKSPACE,
          mcpServers: [],
        });
        if (generation !== currentGeneration || bridge !== nextBridge) {
          await nextBridge.kill().catch(() => {});
          return;
        }
        updateStatus({
          connectionStatus: "connected",
          models: load.models ?? nextBridge.getModelState(ASSISTANT_SESSION_ID) ?? null,
          thoughtLevels:
            load.thoughtLevels ?? nextBridge.getThoughtLevelState(ASSISTANT_SESSION_ID) ?? null,
        });
      } catch (error) {
        if (generation !== currentGeneration || bridge !== nextBridge) return;
        bridge = null;
        await nextBridge.kill().catch(() => {});
        updateStatus({
          connectionStatus: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })().finally(() => {
      starting = null;
    });

    return starting;
  }

  async function requireBridge(): Promise<ACPBridge> {
    await start();
    if (!bridge?.isConnected) {
      throw new Error(status.error ?? "Personal Assistant is not connected.");
    }
    return bridge;
  }

  async function sendPrompt(contents: ContentBlock[]): Promise<PromptResult> {
    const activeBridge = await requireBridge();
    if (status.isStreaming) await cancelPrompt();
    updateStatus({ isStreaming: true });
    ctx.sendEvent("assistant-prompt-start", undefined);

    const messageSegment = await beginAssistantMessageTurn();
    activeMessageSegment = messageSegment;
    try {
      for (const content of contents) {
        await queuePersistAndPublish(
          {
            sessionId: ASSISTANT_SESSION_ID,
            update: { sessionUpdate: "user_message_chunk", content },
          },
          messageSegment,
        );
      }
      return await activeBridge.sendPrompt({
        sessionId: ASSISTANT_SESSION_ID,
        prompt: contents,
      });
    } finally {
      await notificationTail;
      endAssistantMessageTurn(messageSegment);
      if (activeMessageSegment?.id === messageSegment.id) {
        activeMessageSegment = null;
      }
      updateStatus({ isStreaming: false });
      ctx.sendEvent("assistant-prompt-end", undefined);
    }
  }

  async function cancelPrompt(): Promise<void> {
    if (!bridge?.isConnected) return;
    await bridge.cancel({ sessionId: ASSISTANT_SESSION_ID }).catch(() => {});
  }

  async function setModel(modelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setSessionModel({ sessionId: ASSISTANT_SESSION_ID, modelId });
    updateStatus({ models: activeBridge.getModelState(ASSISTANT_SESSION_ID) ?? status.models });
  }

  async function setThoughtLevel(thoughtLevelId: string): Promise<void> {
    const activeBridge = await requireBridge();
    await activeBridge.setThoughtLevel({
      sessionId: ASSISTANT_SESSION_ID,
      thoughtLevelId,
    });
    updateStatus({
      thoughtLevels:
        activeBridge.getThoughtLevelState(ASSISTANT_SESSION_ID) ?? status.thoughtLevels,
    });
  }

  async function refreshConfiguration(): Promise<void> {
    await cancelPrompt();
    await stop();
    await start();
  }

  async function stop(): Promise<void> {
    generation += 1;
    const activeBridge = bridge;
    bridge = null;
    starting = null;
    updateStatus({ connectionStatus: "disconnected", isStreaming: false });
    await activeBridge?.kill().catch(() => {});
  }

  return {
    start,
    stop,
    getStatus: () => status,
    getHistorySegment,
    sendPrompt,
    cancelPrompt,
    setModel,
    setThoughtLevel,
    refreshConfiguration,
  };
}
